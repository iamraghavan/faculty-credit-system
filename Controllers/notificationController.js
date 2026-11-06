// Controllers/notificationController.js
'use strict';

const fs = require('fs').promises;
const path = require('path');
const User = require('../Models/User'); // your DynamoDB-based User model
const { sendEmail } = require('../utils/email');
const { generateRemarkPdf } = require('../utils/pdfGenerator');
const { sendPushToUser } = require('./pushController');
const { recalcFacultyCredits } = require('../utils/calculateCredits');
const { sendWhatsAppMessage } = require('../utils/whatsapp');
const { sendRemarkNotificationHelper } = require('../utils/notificationHelper');
const Notification = require('../Models/Notification');
require('dotenv').config();

const TEMPLATE_DIR = path.join(__dirname, '..', 'email-templates');

/**
 * POST /api/v1/notifications/remark
 */
async function sendRemarkNotification(req, res, next) {
  try {
    console.log('--- Notification Controller: Send Remark ---');
    console.log('Body:', JSON.stringify(req.body, null, 2));

    const { facultyId } = req.body;
    // Support both flattened and nested structures to be safe
    const title = req.body.title || (req.body.remark && req.body.remark.title);
    const academicYear = req.body.academicYear || new Date().getFullYear();
    const points = req.body.points || (req.body.remark && req.body.remark.points) || 0;
    const message = req.body.notes || req.body.message || (req.body.remark && req.body.remark.message);

    const issuerName = req.user && req.user.name ? req.user.name : 'Administrator';

    if (!facultyId || !title) {
      return res.status(400).json({ success: false, message: 'Missing facultyId or title' });
    }

    // find faculty
    const faculty = await User.findById(facultyId);
    if (!faculty || !faculty.email) {
      return res.status(404).json({ success: false, message: 'Faculty not found or has no email' });
    }

    const dateStr = new Date().toLocaleDateString('en-IN', { dateStyle: 'long' });
    const portalUrl = process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/faculty/credits` : '#';
    const pointsValue = Number(points) || 0;

    // --- Use Notification Helper ---
    await sendRemarkNotificationHelper({
      faculty,
      title,
      points: pointsValue,
      academicYear,
      notes: message,
      issuerName,
      portalUrl,
    });

    return res.json({ success: true, message: 'Notification processed (Email + Push + WhatsApp)' });
  } catch (err) {
    console.error('sendRemarkNotification error:', err);
    return next(err);
  }
}

async function broadcastNotification(req, res, next) {
  try {
    const { title, body, url, icon } = req.body;
    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'Title and body are required for broadcast' });
    }

    const payload = {
      title,
      body,
      url: url || (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/faculty/credits` : '#'),
      icon: icon || '/favicon.ico',
      data: { type: 'broadcast', timestamp: new Date().toISOString() },
    };

    // 1. Get all Web Push Subscriptions
    const PushSubscription = require('../Models/PushSubscription');
    const webpush = require('web-push');

    // Configure web-push if not already
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(
        process.env.VAPID_MAILTO || 'mailto:admin@example.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY,
      );
    }

    const subscriptions = await PushSubscription.getAll();
    const pushPromises = subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await PushSubscription.delete(sub.endpoint);
        }
      }
    });

    // 2. Get all Users with FCM Tokens
    const { sendFcmNotification } = require('../utils/firebase');
    const users = await User.find(); // Find all users
    const fcmPromises = users.filter((u) => u.fcmToken).map((u) => sendFcmNotification(u.fcmToken, payload));

    const inAppPromises = users
      .filter((user) => user.isActive !== false)
      .map((user) =>
        Notification.create({
          userId: user._id || user.id,
          type: 'broadcast',
          title,
          message: body,
          url: payload.url,
          icon: payload.icon,
          channels: { inApp: 'delivered' },
        }),
      );

    const emailPromises = users
      .filter((user) => user.isActive !== false && user.email)
      .map((user) =>
        sendEmail({
          to: user.email,
          subject: title,
          text: `${title}\n\n${body}\n\n${payload.url}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto"><h2 style="color:#17324d">${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p><p><a href="${escapeHtml(payload.url)}">Open CreditWise</a></p><hr><small>E.G.S. Pillay Group of Institutions</small></div>`,
        }),
      );

    // Run all in parallel
    const deliveries = await Promise.allSettled([...pushPromises, ...fcmPromises, ...inAppPromises, ...emailPromises]);

    return res.json({
      success: true,
      message: 'Broadcast processed',
      deliveries: { total: deliveries.length, failed: deliveries.filter((item) => item.status === 'rejected').length },
    });
  } catch (err) {
    next(err);
  }
}

function escapeHtml(value) {
  return String(value || '').replace(
    /[&<>'"]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character],
  );
}

async function listNotifications(req, res, next) {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const recent = await Notification.findByUserId(req.user._id || req.user.id, 200);
    res.json({ success: true, items: recent.slice(0, limit), unreadCount: recent.filter((item) => !item.read).length });
  } catch (error) {
    next(error);
  }
}

async function markNotificationRead(req, res, next) {
  try {
    const item = await Notification.findById(req.params.id);
    if (!item || String(item.userId) !== String(req.user._id || req.user.id))
      return res.status(404).json({ success: false, message: 'Notification not found' });
    res.json({ success: true, item: await Notification.markRead(item._id, req.user._id || req.user.id) });
  } catch (error) {
    next(error);
  }
}

async function markAllNotificationsRead(req, res, next) {
  try {
    const items = await Notification.findByUserId(req.user._id || req.user.id, 200);
    await Promise.all(
      items.filter((item) => !item.read).map((item) => Notification.markRead(item._id, req.user._id || req.user.id)),
    );
    res.json({ success: true, updatedCount: items.filter((item) => !item.read).length });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  sendRemarkNotification,
  broadcastNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};

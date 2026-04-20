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

    const issuerName = (req.user && req.user.name) ? req.user.name : 'Administrator';

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
      portalUrl
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
      data: { type: 'broadcast', timestamp: new Date().toISOString() }
    };

    // 1. Get all Web Push Subscriptions
    const PushSubscription = require('../Models/PushSubscription');
    const webpush = require('web-push');

    // Configure web-push if not already
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(
        process.env.VAPID_MAILTO || 'mailto:admin@example.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
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
    const fcmPromises = users
      .filter(u => u.fcmToken)
      .map(u => sendFcmNotification(u.fcmToken, payload));

    // Run all in parallel
    await Promise.allSettled([...pushPromises, ...fcmPromises]);

    return res.json({ success: true, message: 'Broadcast sent to all active devices' });
  } catch (err) {
    next(err);
  }
}

module.exports = { sendRemarkNotification, broadcastNotification };

const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const fsPromises = fs.promises;
const PushSubscription = require('../Models/PushSubscription');
const { sendEmail } = require('../utils/email');
const { generateRemarkPdf } = require('../utils/pdfGenerator');
const { sendFcmNotification } = require('../utils/firebase');
const User = require('../Models/User');
const Notification = require('../Models/Notification');
const { isTrustedPushEndpoint } = require('../utils/pushEndpoint');
const { changeDevice, tokensForUser } = require('../utils/notificationDevices');
require('dotenv').config();

// Configure web-push
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_MAILTO || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
} else {
  console.warn('VAPID Keys not found. Web Push will not work.');
}

/**
 * Save a new subscription for a user
 * POST /api/v1/notifications/subscribe
 */
async function subscribe(req, res, next) {
  try {
    const subscription = req.body;
    const user = req.user;

    if (
      !subscription ||
      !isTrustedPushEndpoint(subscription.endpoint) ||
      !subscription.keys ||
      typeof subscription.keys.p256dh !== 'string' ||
      typeof subscription.keys.auth !== 'string'
    ) {
      return res.status(400).json({ success: false, message: 'Invalid subscription object' });
    }

    await PushSubscription.create({
      userId: String(user._id),
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json({ success: true, message: 'Subscribed to notifications' });
  } catch (err) {
    next(err);
  }
}

/**
 * Send a push notification to a specific user
 * @param {string} userId
 * @param {Object} payload { title, body, icon, url }
 */
async function sendPushToUser(userId, payload) {
  try {
    const user = await User.findById(userId);
    const channelStatus = {
      inApp: 'pending',
      webPush: 'not_subscribed',
      fcm: 'not_configured',
      email: 'not_configured',
    };

    const inApp = await Notification.create({
      userId,
      type: payload.type || payload.data?.type || 'general',
      title: payload.title,
      message: payload.body,
      url: payload.url,
      icon: payload.icon,
      metadata: payload.data || {},
      channels: channelStatus,
    });
    channelStatus.inApp = 'delivered';

    let subscriptions = [];
    try {
      subscriptions = await PushSubscription.findByUserId(userId);
    } catch (error) {
      console.error('Legacy web push unavailable:', error.name || error.message);
      channelStatus.webPush = 'unavailable';
    }
    const notificationPayload = JSON.stringify(payload);
    const promises = (subscriptions || []).map(async (sub) => {
      try {
        if (!isTrustedPushEndpoint(sub.endpoint)) return;
        await webpush.sendNotification(sub, notificationPayload);
        channelStatus.webPush = 'delivered';
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await PushSubscription.delete(sub.endpoint);
        } else {
          console.error('Error sending push:', err);
        }
      }
    });

    await Promise.all(promises);

    // FCM is independent of Web Push subscriptions.
    const tokens = tokensForUser(user);
    if (tokens.length) {
      const results = await Promise.allSettled(
        tokens.map((token) =>
          sendFcmNotification(token, {
            title: payload.title,
            body: payload.body,
            url: payload.url,
            icon: payload.icon,
            data: payload.data,
          }),
        ),
      );
      channelStatus.fcm = results.some(
        (result) => result.status === 'fulfilled' && result.value && result.value !== 'INVALID_TOKEN',
      )
        ? 'delivered'
        : 'unavailable';
    }

    // Transactional email is enabled by default; callers that already send a richer email can opt out.
    if (user?.email && payload.email !== false) {
      try {
        await sendEmail({
          to: user.email,
          subject: payload.title,
          text: `${payload.title}\n\n${payload.body}\n\nOpen CreditWise: ${payload.url || process.env.FRONTEND_URL || ''}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto"><h2 style="color:#17324d">${escapeHtml(payload.title)}</h2><p>${escapeHtml(payload.body)}</p><p><a href="${escapeHtml(payload.url || process.env.FRONTEND_URL || '#')}">Open CreditWise</a></p><hr><small>E.G.S. Pillay Group of Institutions</small></div>`,
        });
        channelStatus.email = 'delivered';
      } catch (error) {
        console.error('Notification email delivery failed:', error.name || error.message);
        channelStatus.email = 'unavailable';
      }
    }
    return { notificationId: inApp._id, channels: channelStatus };
  } catch (err) {
    console.error('Failed to send push batch:', err);
    return { error: err.message };
  }
}

function escapeHtml(value) {
  return String(value || '').replace(
    /[&<>'"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char],
  );
}

/**
 * Update FCM device token for the current user
 * PUT /api/v1/notifications/device-token
 */
async function updateDeviceToken(req, res, next) {
  try {
    const { fcmToken, platform = 'web' } = req.body || {};
    const user = req.user;

    if (!fcmToken) {
      return res.status(400).json({ success: false, message: 'fcmToken is required' });
    }

    const result = await changeDevice(String(user._id || user.id), fcmToken, platform);
    res.status(200).json({ success: true, message: 'Device registered for notifications', ...result });
  } catch (err) {
    next(err);
  }
}

async function removeDeviceToken(req, res, next) {
  try {
    const { fcmToken } = req.body || {};
    const result = await changeDevice(String(req.user._id || req.user.id), fcmToken, null);
    res.json({ success: true, message: 'Device removed from notifications', ...result });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  subscribe,
  updateDeviceToken,
  removeDeviceToken,
  sendPushToUser,
};

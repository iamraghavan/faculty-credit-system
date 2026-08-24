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
require('dotenv').config();

// Configure web-push
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_MAILTO || 'mailto:admin@example.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
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

        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ success: false, message: 'Invalid subscription object' });
        }

        await PushSubscription.create({
            userId: String(user._id),
            endpoint: subscription.endpoint,
            keys: subscription.keys,
            userAgent: req.headers['user-agent']
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
        const channelStatus = { inApp: 'pending', webPush: 'not_subscribed', fcm: 'not_configured', email: 'not_configured' };

        const inApp = await Notification.create({
            userId, type: payload.type || payload.data?.type || 'general', title: payload.title,
            message: payload.body, url: payload.url, icon: payload.icon,
            metadata: payload.data || {}, channels: channelStatus,
        });
        channelStatus.inApp = 'delivered';

        const subscriptions = await PushSubscription.findByUserId(userId);
        const notificationPayload = JSON.stringify(payload);
        const promises = (subscriptions || []).map(async (sub) => {
            try {
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
        if (user && user.fcmToken) {
            await sendFcmNotification(user.fcmToken, {
                title: payload.title,
                body: payload.body,
                url: payload.url,
                icon: payload.icon,
                data: payload.data
            });
            channelStatus.fcm = 'delivered';
        }

        // Transactional email is enabled by default; callers that already send a richer email can opt out.
        if (user?.email && payload.email !== false) {
            await sendEmail({
                to: user.email, subject: payload.title,
                text: `${payload.title}\n\n${payload.body}\n\nOpen CreditWise: ${payload.url || process.env.FRONTEND_URL || ''}`,
                html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto"><h2 style="color:#17324d">${escapeHtml(payload.title)}</h2><p>${escapeHtml(payload.body)}</p><p><a href="${escapeHtml(payload.url || process.env.FRONTEND_URL || '#')}">Open CreditWise</a></p><hr><small>E.G.S. Pillay Group of Institutions</small></div>`,
            });
            channelStatus.email = 'delivered';
        }
        return { notificationId: inApp._id, channels: channelStatus };
    } catch (err) {
        console.error('Failed to send push batch:', err);
        return { error: err.message };
    }
}

function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

/**
 * Update FCM device token for the current user
 * PUT /api/v1/users/device-token
 */
async function updateDeviceToken(req, res, next) {
    try {
        const { fcmToken } = req.body;
        const user = req.user;

        if (!fcmToken) {
            return res.status(400).json({ success: false, message: 'fcmToken is required' });
        }

        await User.update(String(user._id), { fcmToken });

        res.status(200).json({ success: true, message: 'Device token updated successfully' });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    subscribe,
    updateDeviceToken,
    sendPushToUser
};

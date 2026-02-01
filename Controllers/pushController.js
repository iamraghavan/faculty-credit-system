const webpush = require('web-push');
const PushSubscription = require('../Models/PushSubscription');
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
        const subscriptions = await PushSubscription.findByUserId(userId);
        if (!subscriptions || subscriptions.length === 0) return;

        const notificationPayload = JSON.stringify(payload);

        const promises = subscriptions.map(async (sub) => {
            try {
                await webpush.sendNotification(sub, notificationPayload);
            } catch (err) {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    // Subscription/Endpoint is gone, delete it
                    await PushSubscription.delete(sub.endpoint);
                } else {
                    console.error('Error sending push:', err);
                }
            }
        });

        await Promise.all(promises);
    } catch (err) {
        console.error('Failed to send push batch:', err);
    }
}

module.exports = {
    subscribe,
    sendPushToUser
};

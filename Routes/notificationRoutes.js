const express = require('express');
const router = express.Router();
const { subscribe, updateDeviceToken, sendPushToUser } = require('../Controllers/pushController');
const { sendRemarkNotification, broadcastNotification, listNotifications, markNotificationRead, markAllNotificationsRead } = require('../Controllers/notificationController');
const { authMiddleware, requirePermission } = require('../Middleware/authMiddleware');

// Subscribe to push notifications
router.post('/subscribe', authMiddleware, subscribe);

// Update FCM Device Token
router.put('/device-token', authMiddleware, updateDeviceToken);

router.post('/test', authMiddleware, async (req, res, next) => {
  try {
    const result = await sendPushToUser(String(req.user._id || req.user.id), {
      title: 'CreditWise test notification',
      body: 'Push notifications are working.',
      type: 'test',
      email: false,
    });
    if (result.error) return res.status(502).json({ success: false, message: result.error });
    return res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.get('/', authMiddleware, listNotifications);
router.patch('/read-all', authMiddleware, markAllNotificationsRead);
router.patch('/:id/read', authMiddleware, markNotificationRead);

// Manual Remark Notification
router.post('/remark', authMiddleware, requirePermission('credit.issue'), sendRemarkNotification);

// Broadcast Notification (Admin/OA only)
router.post('/broadcast', authMiddleware, requirePermission('notification.broadcast'), broadcastNotification);

module.exports = router;

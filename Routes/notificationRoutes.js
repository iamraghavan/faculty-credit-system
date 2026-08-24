const express = require('express');
const router = express.Router();
const { subscribe, updateDeviceToken } = require('../Controllers/pushController');
const { sendRemarkNotification, broadcastNotification, listNotifications, markNotificationRead, markAllNotificationsRead } = require('../Controllers/notificationController');
const { authMiddleware, requirePermission } = require('../Middleware/authMiddleware');

// Subscribe to push notifications
router.post('/subscribe', authMiddleware, subscribe);

// Update FCM Device Token
router.put('/device-token', authMiddleware, updateDeviceToken);

router.get('/', authMiddleware, listNotifications);
router.patch('/read-all', authMiddleware, markAllNotificationsRead);
router.patch('/:id/read', authMiddleware, markNotificationRead);

// Manual Remark Notification
router.post('/remark', authMiddleware, requirePermission('credit.issue'), sendRemarkNotification);

// Broadcast Notification (Admin/OA only)
router.post('/broadcast', authMiddleware, requirePermission('notification.broadcast'), broadcastNotification);

module.exports = router;

const express = require('express');
const router = express.Router();
const { subscribe, updateDeviceToken } = require('../Controllers/pushController');
const { sendRemarkNotification } = require('../Controllers/notificationController');
const { authMiddleware } = require('../Middleware/authMiddleware');

// Subscribe to push notifications
router.post('/subscribe', authMiddleware, subscribe);

// Update FCM Device Token
router.put('/device-token', authMiddleware, updateDeviceToken);

// Manual Remark Notification
router.post('/remark', authMiddleware, sendRemarkNotification);

module.exports = router;

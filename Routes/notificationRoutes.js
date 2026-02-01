const express = require('express');
const router = express.Router();
const { subscribe, sendRemarkNotification } = require('../Controllers/pushController');
const { authMiddleware } = require('../Middleware/authMiddleware');

// Subscribe to push notifications
router.post('/subscribe', authMiddleware, subscribe);

// Manual Remark Notification
router.post('/remark', authMiddleware, sendRemarkNotification);

module.exports = router;

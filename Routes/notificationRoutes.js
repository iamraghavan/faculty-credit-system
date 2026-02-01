const express = require('express');
const router = express.Router();
const { subscribe } = require('../Controllers/pushController');
const { authMiddleware } = require('../Middleware/authMiddleware');

// Subscribe to push notifications
router.post('/subscribe', authMiddleware, subscribe);

module.exports = router;

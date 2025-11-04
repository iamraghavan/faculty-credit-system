// Routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { register, login, refreshToken } = require('../Controllers/authController');
const { authMiddleware } = require('../Middleware/authMiddleware');

// First user can register without login
router.post('/register', authMiddleware, register);

router.post('/login', login);
router.get('/refresh', authMiddleware, refreshToken);


module.exports = router; 
// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { register, login, refreshToken, bulkRegister, forgotPassword, resetPassword } = require('../Controllers/authController');
const { authMiddleware,  adminOnly} = require('../Middleware/authMiddleware');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// existing
router.post('/register', authMiddleware, register);
router.post('/login', login);
router.get('/refresh', authMiddleware, refreshToken);

// NEW: bulk upload
router.post('/users/bulk-upload', authMiddleware, adminOnly, upload.single('file'), bulkRegister);

router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);

module.exports = router;

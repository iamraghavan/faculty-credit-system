// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { register, login, refreshToken, bulkRegister, forgotPassword, resetPassword,   enableAppMfa,
  verifyAppMfaSetup,
  toggleEmailMfa,
  disableAllMfa,
  verifyMfa, getProfile  } = require('../Controllers/authController');
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

router.post('/mfa/enable-app', authMiddleware, enableAppMfa);
router.post('/mfa/verify-app-setup', authMiddleware, verifyAppMfaSetup);
router.post('/mfa/toggle-email', authMiddleware, toggleEmailMfa);
router.post('/mfa/disable-all', authMiddleware, disableAllMfa);
router.post('/verify-mfa', verifyMfa);


router.get('/profile', authMiddleware, getProfile);

module.exports = router;

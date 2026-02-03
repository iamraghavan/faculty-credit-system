// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const {
  refreshToken,
  verifyMfa, getProfile, changePassword,
  toggleEmailMfa, disableAllMfa,
  listSessions, revokeSession, revokeAllOtherSessions
} = require('../Controllers/authController');

const { register, login } = require('../Controllers/Auth/AuthenticationController');
const { bulkRegister } = require('../Controllers/Auth/BulkImportController');
const { forgotPassword, resetPassword } = require('../Controllers/Auth/PasswordController');
const { enableAppMfa, verifyAppMfaSetup } = require('../Controllers/Auth/MfaController');

const { authMiddleware, adminOnly } = require('../Middleware/authMiddleware');
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

router.post('/change-password', authMiddleware, changePassword);

router.get('/profile', authMiddleware, getProfile);

// Session Management
router.get('/sessions', authMiddleware, listSessions);
router.delete('/sessions/others', authMiddleware, revokeAllOtherSessions);
// WhatsApp Verification
router.post('/whatsapp/send-otp', authMiddleware, sendWhatsappOtp);
router.post('/whatsapp/verify-otp', authMiddleware, verifyWhatsappOtp);

module.exports = router;

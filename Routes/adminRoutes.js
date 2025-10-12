// Routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const { createCreditTitle, listCreditTitles } = require('../Controllers/adminController');
const { authMiddleware, adminOnly } = require('../Middleware/authMiddleware');
const multer = require('multer');
const upload = multer({ dest: 'tmp/uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

const { adminIssueNegativeCredit } = require('../Controllers/creditController');

/**
 * Admin endpoints:
 * POST /api/v1/admin/credit-title  -> create title
 * GET  /api/v1/admin/credit-title  -> list titles
 * POST /api/v1/admin/negative-credit -> give negative credit (with proof)
 */
router.post('/credit-title', authMiddleware, adminOnly, createCreditTitle);
router.get('/credit-title', authMiddleware, listCreditTitles);

// negative credit route
router.post('/negative-credit', authMiddleware, adminOnly, upload.single('proof'), adminIssueNegativeCredit);

module.exports = router;

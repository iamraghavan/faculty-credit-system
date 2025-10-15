const express = require('express');
const router = express.Router();
const multer = require('multer');

const {
  createCreditTitle,
  listCreditTitles,
  updateCreditTitle,
  deleteCreditTitle,
  listPositiveCreditsForAdmin,
  updatePositiveCreditStatus,
  getPositiveCreditById
} = require('../Controllers/adminController');

const { authMiddleware, adminOnly } = require('../Middleware/authMiddleware');
const { adminIssueNegativeCredit } = require('../Controllers/creditController');

// Multer configuration for file uploads
const upload = multer({
  dest: 'tmp/uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

/**
 * Admin endpoints for Credit Titles
 */
router.post('/credit-title', authMiddleware, adminOnly, createCreditTitle);
router.get('/credit-title', authMiddleware, listCreditTitles);
router.put('/credit-title/:id', authMiddleware, adminOnly, updateCreditTitle);
router.delete('/credit-title/:id', authMiddleware, adminOnly, deleteCreditTitle);

/**
 * Admin endpoint for issuing negative credits (with proof)
 */
router.post('/negative-credit', authMiddleware, adminOnly, upload.single('proof'), adminIssueNegativeCredit);

/**
 * Admin endpoints for managing positive Good Works submissions
 */
router.get('/credits/positive', authMiddleware, adminOnly, listPositiveCreditsForAdmin);
router.get('/credits/positive/:id', authMiddleware, adminOnly, getPositiveCreditById);
router.put('/credits/positive/:id/status', authMiddleware, adminOnly, updatePositiveCreditStatus);

module.exports = router;

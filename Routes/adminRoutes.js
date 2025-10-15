const express = require('express');
const router = express.Router();
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
const multer = require('multer');
const upload = multer({ dest: 'tmp/uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

const { adminIssueNegativeCredit } = require('../Controllers/creditController');

/**
 * Admin endpoints:
 * POST   /api/v1/admin/credit-title         -> create title
 * GET    /api/v1/admin/credit-title         -> list titles
 * PUT    /api/v1/admin/credit-title/:id     -> update a title
 * DELETE /api/v1/admin/credit-title/:id     -> delete/deactivate a title
 * POST   /api/v1/admin/negative-credit      -> give negative credit (with proof)
 */

router.post('/credit-title', authMiddleware, adminOnly, createCreditTitle);
router.get('/credit-title', authMiddleware, listCreditTitles);
router.put('/credit-title/:id', authMiddleware, adminOnly, updateCreditTitle);
router.delete('/credit-title/:id', authMiddleware, adminOnly, deleteCreditTitle);

// negative credit route
router.post('/negative-credit', authMiddleware, adminOnly, upload.single('proof'), adminIssueNegativeCredit);

router.get(
  '/credits/positive',
  authMiddleware,
  adminOnly,
  listPositiveCreditsForAdmin
);

router.put(
  '/credits/positive/:id/status',
  authMiddleware,
  adminOnly,
  updatePositiveCreditStatus
);

router.get(
  '/credits/positive/:id',
  authMiddleware,
  adminOnly,
  getPositiveCreditById
);

module.exports = router;

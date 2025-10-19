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
  getPositiveCreditById,
  issueNegativeCredit,
  listNegativeCreditsForFaculty
} = require('../Controllers/adminController');

const { authMiddleware, adminOnly } = require('../Middleware/authMiddleware');

// Multer configuration for file uploads
const upload = multer({
  dest: 'tmp/uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    // only allow images/pdf
    if (!file.mimetype.match(/\/(jpeg|png|jpg|pdf)$/)) {
      return cb(new Error('File type not supported'), false);
    }
    cb(null, true);
  }
});

/**
 * Credit Titles
 */
router.post('/credit-title', authMiddleware, adminOnly, createCreditTitle);
router.get('/credit-title', authMiddleware, listCreditTitles);
router.put('/credit-title/:id', authMiddleware, adminOnly, updateCreditTitle);
router.delete('/credit-title/:id', authMiddleware, adminOnly, deleteCreditTitle);

/**
 * Positive credits management
 */
router.get('/credits/positive', authMiddleware, adminOnly, listPositiveCreditsForAdmin);
router.get('/credits/positive/:id', authMiddleware, adminOnly, getPositiveCreditById);
router.put('/credits/positive/:id/status', authMiddleware, adminOnly, updatePositiveCreditStatus);

/**
 * Negative credits issued by admin to faculty
 */
router.post('/credits/negative', authMiddleware, adminOnly, upload.single('proof'), issueNegativeCredit);

/**
 * Faculty negative credits endpoint (frontend-friendly)
 */
router.get('/faculty/:facultyId/credits/negative', authMiddleware, listNegativeCreditsForFaculty);

module.exports = router;

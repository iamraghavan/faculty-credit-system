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
  listNegativeCreditsForFaculty,
  adminListNegativeCredits,
  adminGetNegativeCreditById,
  adminGetFacultyByNegativeCreditId,
  adminListNegativeCreditAppeals,
  adminGetAppealByCreditId,
  adminUpdateAppealStatus,
  getNegativeAppeals
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

// GET /api/v1/admin/credits/negative
router.get('/credits/negative', adminListNegativeCredits);

// GET /api/v1/admin/credits/negative/:id
router.get('/credits/negative/:id', adminGetNegativeCreditById);

// GET /api/v1/admin/credits/negative/:id/faculty
router.get('/credits/negative/:id/faculty', adminGetFacultyByNegativeCreditId);



router.get('/credits/negative/appeals/all', getNegativeAppeals);


// Get appeal details by creditId
router.get('/credits/negative/:creditId/appeal', authMiddleware, adminOnly, adminGetAppealByCreditId);

// Update appeal status (accept/reject)
router.put('/credits/negative/:creditId/appeal', authMiddleware, adminOnly, adminUpdateAppealStatus);

// Admin: list all negative appeals
router.get('/credits/negative/appeals', authMiddleware, adminOnly, adminListNegativeCreditAppeals);


module.exports = router;

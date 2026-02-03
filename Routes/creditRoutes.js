const express = require('express');
const multer = require('multer');
const router = express.Router();
const {
  submitPositiveCredit,
  appealNegativeCredit,
  listCreditsForFaculty,
  adminIssueNegativeCredit,
  listCreditTitles,
  createCreditTitle,
  getNegativeCredits,
  getNegativeCreditsByFacultyId,
  recalcCreditsController,
  getFacultyCredits,
  updatePositiveCredit,
  deletePositiveCredit,
  updateAppeal,
  deleteAppeal,
  getSingleCredit,
  updateNegativeCredit,
  deleteNegativeCredit
} = require('../Controllers/creditController');

const { authMiddleware, adminOnly } = require('../Middleware/authMiddleware');
const { ensureWhatsappVerified } = require('../Middleware/whatsappMiddleware');
const apiKeyMiddleware = require('../Middleware/apiKeyMiddleware');

// Configure multer to use memory storage (serverless-safe)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = (process.env.ASSET_ALLOWED_EXT ||
      'pdf,png,jpg,jpeg,webp,gif,svg,txt,csv,json,doc,docx,xls,xlsx,zip,mp4,webm'
    ).split(',');
    const ext = file.originalname.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) return cb(new Error('File type not allowed'), false);
    cb(null, true);
  }
});

/**
 * Faculty routes
 */
// Positive Credits
router.post('/credits/positive', authMiddleware, ensureWhatsappVerified, upload.single('proof'), submitPositiveCredit);
router.put('/credits/positive/:creditId', authMiddleware, ensureWhatsappVerified, upload.single('proof'), updatePositiveCredit);
router.delete('/credits/positive/:creditId', authMiddleware, ensureWhatsappVerified, deletePositiveCredit);

router.get('/credits/faculty/:facultyId', authMiddleware, listCreditsForFaculty);

/**
 * Admin routes
 */
router.post('/credit-title', authMiddleware, adminOnly, createCreditTitle);
router.get('/credit-title', authMiddleware, listCreditTitles);
router.post('/credits/negative', authMiddleware, adminOnly, upload.single('proof'), adminIssueNegativeCredit);
router.put('/credits/negative/:creditId', authMiddleware, adminOnly, upload.single('proof'), updateNegativeCredit);
router.delete('/credits/negative/:creditId', authMiddleware, adminOnly, deleteNegativeCredit);

// Faculty: get all negative credits (with filters)
router.get('/credits/negative', authMiddleware, getNegativeCredits);

// Faculty: appeal a negative credit
router.post('/credits/:creditId/appeal', authMiddleware, ensureWhatsappVerified, upload.single('proof'), appealNegativeCredit);
router.put('/credits/appeals/:creditId', authMiddleware, ensureWhatsappVerified, upload.single('proof'), updateAppeal);
router.delete('/credits/appeals/:creditId', authMiddleware, ensureWhatsappVerified, deleteAppeal);

// Get Single Credit details
router.get('/credits/:creditId', authMiddleware, getSingleCredit);

router.get(
  '/credits/faculty/:facultyId/negative',
  authMiddleware,
  getNegativeCreditsByFacultyId
);

router.post('/credits/:facultyId/recalc-credits', authMiddleware, recalcCreditsController);
router.get('/:facultyId/credits', getFacultyCredits);


module.exports = router;

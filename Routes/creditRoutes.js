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

const { authMiddleware, adminOnly, adminOrOA } = require('../Middleware/authMiddleware');
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
router.post('/positive', authMiddleware, ensureWhatsappVerified, upload.single('proof'), submitPositiveCredit);
router.put('/positive/:creditId', authMiddleware, ensureWhatsappVerified, upload.single('proof'), updatePositiveCredit);
router.delete('/positive/:creditId', authMiddleware, ensureWhatsappVerified, deletePositiveCredit);

router.get('/faculty/:facultyId', authMiddleware, listCreditsForFaculty);

/**
 * Admin routes
 */
router.post('/credit-title', authMiddleware, adminOnly, createCreditTitle);
router.get('/credit-title', authMiddleware, listCreditTitles);
router.post('/negative', authMiddleware, adminOrOA, upload.single('proof'), adminIssueNegativeCredit);
router.put('/negative/:creditId', authMiddleware, adminOrOA, upload.single('proof'), updateNegativeCredit);
router.delete('/negative/:creditId', authMiddleware, adminOrOA, deleteNegativeCredit);

// Faculty: get all negative credits (with filters)
router.get('/negative', authMiddleware, getNegativeCredits);

// Faculty: appeal a negative credit
router.post('/:creditId/appeal', authMiddleware, ensureWhatsappVerified, upload.single('proof'), appealNegativeCredit);
router.put('/appeals/:creditId', authMiddleware, ensureWhatsappVerified, upload.single('proof'), updateAppeal);
router.delete('/appeals/:creditId', authMiddleware, ensureWhatsappVerified, deleteAppeal);

// Get Single Credit details
router.get('/:creditId', authMiddleware, getSingleCredit);

router.get(
  '/faculty/:facultyId/negative',
  authMiddleware,
  getNegativeCreditsByFacultyId
);

router.post('/:facultyId/recalc-credits', authMiddleware, recalcCreditsController);
router.get('/:facultyId/raw', getFacultyCredits);


module.exports = router;

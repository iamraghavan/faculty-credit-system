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
} = require('../Controllers/creditController');

const { authMiddleware, adminOnly } = require('../Middleware/authMiddleware');
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
router.post('/credits/positive', authMiddleware, upload.single('proof'), submitPositiveCredit);
router.get('/credits/faculty/:facultyId', authMiddleware, listCreditsForFaculty);

/**
 * Admin routes
 */
router.post('/credit-title', authMiddleware, adminOnly, createCreditTitle);
router.get('/credit-title', authMiddleware, listCreditTitles);
router.post('/credits/negative', authMiddleware, adminOnly, upload.single('proof'), adminIssueNegativeCredit);

// Faculty: get all negative credits (with filters)
router.get('/credits/negative', authMiddleware, getNegativeCredits);

// Faculty: appeal a negative credit (once only)
router.post('/credits/:creditId/appeal', authMiddleware, upload.single('proof'), appealNegativeCredit);

router.get(
  '/credits/faculty/:facultyId/negative',
  authMiddleware,
  getNegativeCreditsByFacultyId
);

router.post('/credits/:facultyId/recalc-credits', authMiddleware, recalcCreditsController);
router.get('/:facultyId/credits', getFacultyCredits);

module.exports = router;

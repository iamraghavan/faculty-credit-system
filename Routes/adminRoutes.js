const express = require('express');
const router = express.Router();
const multer = require('multer');

const {
  updatePositiveCreditStatus,
  getPositiveCreditById,
  adminListNegativeCredits,
  adminGetNegativeCreditById,
  adminGetFacultyByNegativeCreditId,
  adminListNegativeCreditAppeals,
  adminGetAppealByCreditId,
  adminUpdateAppealStatus,
  getNegativeAppeals,
  oaGetOwnIssuedCredits,
  oaDeleteIssuedCredit,
  listNegativeCreditsForFaculty
} = require('../Controllers/adminController');

const {
  createCreditTitle,
  listCreditTitles,
  updateCreditTitle,
  deleteCreditTitle
} = require('../Controllers/Admin/CreditTitleController');

const {
  listPositiveCreditsForAdmin,
  // listNegativeCreditsForFaculty // moved here if refactored fully, else keep legacy
} = require('../Controllers/Admin/CreditListController');

const {
  issueNegativeCredit,
  issuePositiveCredit
} = require('../Controllers/Admin/CreditManageController');


const { authMiddleware, adminOnly, adminOrOA } = require('../Middleware/authMiddleware');

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
router.post('/credits/positive', authMiddleware, adminOrOA, upload.single('proof'), issuePositiveCredit);

/**
 * Negative credits issued by admin to faculty
 */
router.post('/credits/negative', authMiddleware, adminOrOA, upload.single('proof'), issueNegativeCredit);

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

// OA-only endpoint: get credits issued by the logged-in OA
router.get('/oa/credits/issued', authMiddleware, adminOrOA, oaGetOwnIssuedCredits);

router.delete('/oa/credits/issued/:id', authMiddleware, adminOrOA, oaDeleteIssuedCredit);


module.exports = router;

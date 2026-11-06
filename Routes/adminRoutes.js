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
  listNegativeCreditsForFaculty,
  adminReopenAppealWindow,
} = require('../Controllers/adminController');

const {
  createCreditTitle,
  listCreditTitles,
  updateCreditTitle,
  deleteCreditTitle,
} = require('../Controllers/Admin/CreditTitleController');

const {
  listPositiveCreditsForAdmin,
  // listNegativeCreditsForFaculty // moved here if refactored fully, else keep legacy
} = require('../Controllers/Admin/CreditListController');

const {
  issueNegativeCredit,
  issuePositiveCredit,
  voidPositiveCredit,
} = require('../Controllers/Admin/CreditManageController');

const {
  authMiddleware,
  adminOnly,
  adminOrOA,
  requirePermission,
  requireSelfOrPermission,
} = require('../Middleware/authMiddleware');
const { updateOwnIssuedCredit, voidOwnIssuedCredit } = require('../Controllers/oaCreditController');
const { requireOpenAcademicYear } = require('../Middleware/academicYearMiddleware');
const {
  getFacultyLedger,
  exportFacultyLedger,
  getFacultyRanking,
  exportFacultyRanking,
} = require('../Controllers/facultyLedgerController');

// Configure multer to use memory storage (serverless-safe)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = (
      process.env.ASSET_ALLOWED_EXT || 'pdf,png,jpg,jpeg,webp,gif,svg,txt,csv,json,doc,docx,xls,xlsx,zip,mp4,webm'
    ).split(',');
    const ext = file.originalname.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) return cb(new Error('File type not allowed'), false);
    cb(null, true);
  },
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
router.post(
  '/credits/positive',
  authMiddleware,
  adminOrOA,
  upload.single('proof'),
  requireOpenAcademicYear,
  issuePositiveCredit,
);
router.delete('/credits/positive/:id', authMiddleware, adminOnly, voidPositiveCredit);

/**
 * Negative credits issued by admin to faculty
 */
router.post(
  '/credits/negative',
  authMiddleware,
  adminOrOA,
  upload.single('proof'),
  requireOpenAcademicYear,
  issueNegativeCredit,
);

/**
 * Faculty negative credits endpoint (frontend-friendly)
 */
router.get(
  '/faculty/:facultyId/credits/negative',
  authMiddleware,
  requireSelfOrPermission('facultyId', 'credit.read:any'),
  listNegativeCreditsForFaculty,
);

// GET /api/v1/admin/credits/negative
router.get('/credits/negative', authMiddleware, adminOnly, adminListNegativeCredits);
router.get('/credits/negative/appeals', authMiddleware, adminOnly, adminListNegativeCreditAppeals);

// GET /api/v1/admin/credits/negative/:id
router.get('/credits/negative/:id', authMiddleware, adminOnly, adminGetNegativeCreditById);

// GET /api/v1/admin/credits/negative/:id/faculty
router.get('/credits/negative/:id/faculty', authMiddleware, adminOnly, adminGetFacultyByNegativeCreditId);

router.get('/credits/negative/appeals/all', authMiddleware, adminOnly, getNegativeAppeals);

// Get appeal details by creditId
router.get('/credits/negative/:creditId/appeal', authMiddleware, adminOnly, adminGetAppealByCreditId);

// Update appeal status (accept/reject)
router.put('/credits/negative/:creditId/appeal', authMiddleware, adminOnly, adminUpdateAppealStatus);

// Admin/OA: Re-open appeal window for a specific credit
router.patch(
  ['/credits/negative/:creditId/reopen', '/credits/credits/negative/:creditId/reopen'],
  authMiddleware,
  adminOrOA,
  adminReopenAppealWindow,
);

// OA-only endpoint: get credits issued by the logged-in OA
router.get('/oa/credits/issued', authMiddleware, requirePermission('credit.read:own-issued'), oaGetOwnIssuedCredits);

router.patch(
  '/oa/credits/issued/:id',
  authMiddleware,
  requirePermission('credit.edit:own-issued'),
  upload.single('proof'),
  requireOpenAcademicYear,
  updateOwnIssuedCredit,
);
router.delete(
  '/oa/credits/issued/:id',
  authMiddleware,
  requirePermission('credit.void:own-issued'),
  voidOwnIssuedCredit,
);

// Admin: individual faculty credit ledger and professional-detail exports
router.get('/faculty/:facultyId/credit-ledger', authMiddleware, adminOnly, getFacultyLedger);
router.get('/faculty/:facultyId/credit-ledger/export', authMiddleware, adminOnly, exportFacultyLedger);
router.get('/faculty-ledger/ranking', authMiddleware, adminOnly, getFacultyRanking);
router.get('/faculty-ledger/ranking/export', authMiddleware, adminOnly, exportFacultyRanking);

module.exports = router;

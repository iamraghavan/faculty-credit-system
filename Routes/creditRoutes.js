// Routes/creditRoutes.js
const express = require('express');
const multer = require('multer');
const router = express.Router();
const {
  submitPositiveCredit,
  appealNegativeCredit,
  listCreditsForFaculty
} = require('../Controllers/creditController');

const { authMiddleware } = require('../Middleware/authMiddleware');
const apiKeyMiddleware = require('../Middleware/apiKeyMiddleware');

// configure multer for temporary uploads
const upload = multer({
  dest: 'tmp/uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = (process.env.ASSET_ALLOWED_EXT || 'pdf,png,jpg,jpeg,webp,gif,svg,txt,csv,json,doc,docx,xls,xlsx,zip,mp4,webm').split(',');
    const ext = file.originalname.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) return cb(new Error('File type not allowed'), false);
    cb(null, true);
  }
});

/**
 * POST /api/v1/credits/positive  -> faculty submit positive credit (auth or apiKey)
 * POST /api/v1/credits/:creditId/appeal -> appeal
 * GET  /api/v1/credits/faculty/:facultyId -> list credits for faculty
 */
router.post('/positive', [authMiddleware, upload.single('proof')], submitPositiveCredit); // faculty via token
// Optionally allow API key users (if you prefer):
// router.post('/positive/apikey', apiKeyMiddleware, upload.single('proof'), submitPositiveCredit);

router.post('/:creditId/appeal', authMiddleware, appealNegativeCredit);
router.get('/faculty/:facultyId', authMiddleware, listCreditsForFaculty);

module.exports = router;

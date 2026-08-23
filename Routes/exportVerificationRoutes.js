const express = require('express');
const { verifyExport, createOfficialExcel } = require('../Controllers/exportVerificationController');
const { authMiddleware, requirePermission } = require('../Middleware/authMiddleware');

const router = express.Router();
router.get('/verify/:token', verifyExport);
router.post('/official-excel', authMiddleware, requirePermission('export.official'), createOfficialExcel);

module.exports = router;

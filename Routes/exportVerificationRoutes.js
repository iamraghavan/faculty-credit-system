const express = require('express');
const { verifyExport, createOfficialExcel } = require('../Controllers/exportVerificationController');
const { authMiddleware, adminOrOA } = require('../Middleware/authMiddleware');

const router = express.Router();
router.get('/verify/:token', verifyExport);
router.post('/official-excel', authMiddleware, adminOrOA, createOfficialExcel);

module.exports = router;

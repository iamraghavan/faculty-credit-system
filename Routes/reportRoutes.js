const express = require('express');
const router = express.Router();
const { getReportData, downloadReport } = require('../Controllers/reportController');
const { authMiddleware, adminOrOA } = require('../Middleware/authMiddleware');

/**
 * Reporting Routes
 */

// Get JSON data for frontend table
router.get('/', authMiddleware, adminOrOA, getReportData);

// Download file (PDF/Excel) or generate share link
router.get('/download', authMiddleware, adminOrOA, downloadReport);

module.exports = router;

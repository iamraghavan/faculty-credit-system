const express = require('express');
const router = express.Router();
const { getReportData, downloadReport } = require('../Controllers/reportController');
const { authMiddleware, requirePermission } = require('../Middleware/authMiddleware');

/**
 * Reporting Routes
 */

// Get JSON data for frontend table
router.get('/', authMiddleware, requirePermission('report.read'), getReportData);

// Download file (PDF/Excel) or generate share link
router.get('/download', authMiddleware, requirePermission('report.export'), downloadReport);

module.exports = router;

const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('../Middleware/authMiddleware');
const {
  getUserAnalytics,
  getCreditAnalytics,
  getCreditTitleAnalytics,
  getAcademicYearInsights,
  getCreditTrends,
} = require('../Controllers/analyticsController');
const { getDashboardOverview } = require('../Controllers/Admin/DashboardController');

// 🔒 Admin protected routes
router.get('/users', authMiddleware, adminOnly, getUserAnalytics);
router.get('/dashboard', authMiddleware, adminOnly, getDashboardOverview);
router.get('/credits', authMiddleware, adminOnly, getCreditAnalytics);
router.get('/credit-titles', authMiddleware, adminOnly, getCreditTitleAnalytics);
router.get('/academic-years', authMiddleware, adminOnly, getAcademicYearInsights);
router.get('/credit-trends', authMiddleware, adminOnly, getCreditTrends);

module.exports = router;

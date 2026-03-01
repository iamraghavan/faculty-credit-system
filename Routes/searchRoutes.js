const express = require('express');
const router = express.Router();
const { globalSearch } = require('../Controllers/searchController');
const { authMiddleware } = require('../Middleware/authMiddleware');

/**
 * Global Search Route
 * GET /api/v1/search
 */
router.get('/', authMiddleware, globalSearch);

module.exports = router;

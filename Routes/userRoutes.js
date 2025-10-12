// Routes/userRoutes.js
const express = require('express');
const router = express.Router();
const { getProfile, adminCreateUser, listUsers } = require('../Controllers/userController');
const { authMiddleware, adminOnly } = require('../Middleware/authMiddleware');

/**
 * GET /api/v1/users/me  -> protected
 * POST /api/v1/users/   -> admin create user
 * GET /api/v1/users/    -> admin list users (pagination)
 */

router.get('/me', authMiddleware, getProfile);
router.post('/', authMiddleware, adminOnly, adminCreateUser);
router.get('/', authMiddleware, adminOnly, listUsers);

module.exports = router;

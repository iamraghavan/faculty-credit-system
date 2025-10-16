// Routes/userRoutes.js
const express = require('express');
const router = express.Router();
const upload = require('../Middleware/upload');
const {
  getProfile,
  updateProfile,
  adminCreateUser,
  listUsers,
  getUserById,
  adminUpdateUser,
  deleteUser,
} = require('../Controllers/userController');
const { authMiddleware, adminOnly } = require('../Middleware/authMiddleware');

/**
 * User routes
 */
router.get('/me', authMiddleware, getProfile);
router.put('/me', authMiddleware, upload.single('profileImage'), updateProfile);

/**
 * Admin routes
 */
router.post('/', authMiddleware, adminOnly, adminCreateUser);
router.get('/', authMiddleware, adminOnly, listUsers);
router.get('/:id', authMiddleware, adminOnly, getUserById);
router.put('/:id', authMiddleware, adminOnly, upload.single('profileImage'), adminUpdateUser);
router.delete('/:id', authMiddleware, adminOnly, deleteUser);

module.exports = router;

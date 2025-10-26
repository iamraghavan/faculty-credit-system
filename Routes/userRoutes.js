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
router.post('/', authMiddleware, adminCreateUser);
router.get('/', authMiddleware, listUsers);
router.get('/:id', authMiddleware, getUserById);
router.put('/:id', authMiddleware, upload.single('profileImage'), adminUpdateUser);
router.delete('/:id', authMiddleware, deleteUser);

module.exports = router;

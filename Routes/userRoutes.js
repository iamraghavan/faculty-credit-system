const express = require('express');
const router = express.Router();
const formidable = require('express-formidable');
const {
  getProfile,
  updateProfile,
  adminCreateUser,
  listUsers,
  getUserById,
  adminUpdateUser,
  deleteUser,
} = require('../Controllers/userController');
const { authMiddleware } = require('../Middleware/authMiddleware');

/**
 * Use formidable to parse form-data directly into memory
 */
const parseForm = formidable({
  multiples: false,
  keepExtensions: true,
  maxFileSize: 10 * 1024 * 1024, // 10MB max
});

/**
 * User routes
 */
router.get('/me', authMiddleware, getProfile);
router.put('/me', authMiddleware, parseForm, updateProfile);

/**
 * Admin routes
 */
router.post('/', authMiddleware, parseForm, adminCreateUser);
router.get('/', authMiddleware, listUsers);
router.get('/:id', authMiddleware, getUserById);
router.put('/:id', authMiddleware, parseForm, adminUpdateUser);
router.delete('/:id', authMiddleware, deleteUser);

module.exports = router;

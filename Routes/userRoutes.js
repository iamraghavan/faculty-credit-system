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
  changePassword,
  getMfaSetup,
  enableMfa,
  disableMfa
} = require('../Controllers/userController');
const { authMiddleware, adminOrOA } = require('../Middleware/authMiddleware');

/**
 * Use formidable to parse form-data directly into memory
 */
const parseForm = formidable({
  multiples: false,
  keepExtensions: true,
  maxFileSize: 10 * 1024 * 1024, // 10MB max
});

// 02

/**
 * User routes (Self)
 */
router.get('/me', authMiddleware, getProfile);
router.put('/me', authMiddleware, parseForm, updateProfile);
router.put('/me/password', authMiddleware, changePassword);
router.get('/me/mfa/setup', authMiddleware, getMfaSetup);
router.post('/me/mfa/enable', authMiddleware, enableMfa);
router.post('/me/mfa/disable', authMiddleware, disableMfa);

/**
 * Admin routes
 */
router.post('/', authMiddleware, adminOrOA, parseForm, adminCreateUser);
router.get('/', authMiddleware, adminOrOA, listUsers);
router.get('/:id', authMiddleware, adminOrOA, getUserById);
router.put('/:id', authMiddleware, adminOrOA, parseForm, adminUpdateUser);
router.delete('/:id', authMiddleware, adminOrOA, deleteUser);

module.exports = router;

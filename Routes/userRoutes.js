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
  disableMfa,
  getSessions,
  exportUserData
} = require('../Controllers/userController');
const { authMiddleware, requirePermission } = require('../Middleware/authMiddleware');
const {
  getOwnProfessionalProfile, getFacultyProfessionalProfile,
  updateOwnProfessionalProfile, updateFacultyEmployment,
} = require('../Controllers/facultyProfileController');

/**
 * Use formidable to parse form-data directly into memory
 */
const parseForm = formidable({
  multiples: false,
  keepExtensions: true,
  maxFileSize: 10 * 1024 * 1024, // 10MB max
});

// 01

/**
 * User routes (Self)
 */
router.get('/me', authMiddleware, getProfile);
router.put('/me', authMiddleware, parseForm, updateProfile);
router.put('/me/password', authMiddleware, changePassword);
router.get('/me/mfa/setup', authMiddleware, getMfaSetup);
router.post('/me/mfa/enable', authMiddleware, enableMfa);
router.post('/me/mfa/disable', authMiddleware, disableMfa);
router.get('/me/sessions', authMiddleware, getSessions);
router.get('/me/export', authMiddleware, exportUserData);
router.get('/me/professional-profile', authMiddleware, getOwnProfessionalProfile);
router.patch('/me/professional-profile', authMiddleware, requirePermission('profile.update:self'), updateOwnProfessionalProfile);

/**
 * Admin routes
 */
router.post('/', authMiddleware, requirePermission('user.create'), parseForm, adminCreateUser);
router.get('/', authMiddleware, requirePermission('user.read'), listUsers);
router.get('/:id/professional-profile', authMiddleware, requirePermission('profile.read:any'), getFacultyProfessionalProfile);
router.put('/:id/employment', authMiddleware, requirePermission('profile.update:any'), updateFacultyEmployment);
router.get('/:id', authMiddleware, requirePermission('user.read'), getUserById);
router.put('/:id', authMiddleware, requirePermission('user.update'), parseForm, adminUpdateUser);
router.delete('/:id', authMiddleware, requirePermission('user.deactivate'), deleteUser);

module.exports = router;

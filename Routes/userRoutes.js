const express = require('express');
const router = express.Router();
const formidable = require('express-formidable');
const {
  getProfile,
  updateProfile,
  changePassword,
  getMfaSetup,
  enableMfa,
  disableMfa,
  getSessions,
  exportUserData,
} = require('../Controllers/userController');
const {
  createUser,
  listUsers,
  getUser,
  updateUser,
  deactivateUser,
  resetUserPassword,
} = require('../Controllers/Admin/UserManagementController');
const { transferUser } = require('../Controllers/Admin/UserManagementController');
const { authMiddleware, requirePermission, requireAnyPermission } = require('../Middleware/authMiddleware');
const {
  getOwnProfessionalProfile,
  getFacultyProfessionalProfile,
  updateOwnProfessionalProfile,
  updateFacultyEmployment,
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
router.post('/me/mfa/setup', authMiddleware, getMfaSetup);
router.post('/me/mfa/enable', authMiddleware, enableMfa);
router.post('/me/mfa/disable', authMiddleware, disableMfa);
router.get('/me/sessions', authMiddleware, getSessions);
router.get('/me/export', authMiddleware, exportUserData);
router.get('/me/professional-profile', authMiddleware, getOwnProfessionalProfile);
router.patch(
  '/me/professional-profile',
  authMiddleware,
  requirePermission('profile.update:self'),
  updateOwnProfessionalProfile,
);

/**
 * Admin routes
 */
router.post('/', authMiddleware, requirePermission('user.create'), parseForm, createUser);
router.get('/', authMiddleware, requireAnyPermission('user.read', 'user.read:faculty'), listUsers);
router.get(
  '/:id/professional-profile',
  authMiddleware,
  requirePermission('profile.read:any'),
  getFacultyProfessionalProfile,
);
router.put('/:id/employment', authMiddleware, requirePermission('profile.update:any'), updateFacultyEmployment);
router.get('/:id', authMiddleware, requireAnyPermission('user.read', 'user.read:faculty'), getUser);
router.put('/:id', authMiddleware, requirePermission('user.update'), parseForm, updateUser);
router.post('/:id/reset-password', authMiddleware, requirePermission('user.update'), resetUserPassword);
router.post('/:id/transfer', authMiddleware, requirePermission('user.transfer'), transferUser);
router.delete('/:id', authMiddleware, requirePermission('user.deactivate'), deactivateUser);

module.exports = router;

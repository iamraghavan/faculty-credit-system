const router = require('express').Router();
const { authMiddleware, requirePermission } = require('../Middleware/authMiddleware');
const { getConfiguration, updateConfiguration } = require('../Controllers/Admin/ApplicationSettingsController');
router.get('/', authMiddleware, getConfiguration);
router.put('/', authMiddleware, requirePermission('settings.manage'), updateConfiguration);
module.exports = router;

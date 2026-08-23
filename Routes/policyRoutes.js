const express = require('express');
const controller = require('../Controllers/creditPolicyController');
const { authMiddleware, requirePermission } = require('../Middleware/authMiddleware');

const router = express.Router();
router.use(authMiddleware);
router.get('/', requirePermission('policy.read'), controller.listPolicies);
router.post('/', requirePermission('policy.draft'), controller.createPolicy);
router.get('/:policyId/versions/:version', requirePermission('policy.read'), controller.getPolicy);
router.post('/:policyId/versions', requirePermission('policy.draft'), controller.createVersion);
router.put('/:policyId/versions/:version', requirePermission('policy.draft'), controller.updateDraft);
router.post('/:policyId/versions/:version/preview', requirePermission('policy.read'), controller.previewCalculation);
router.post('/:policyId/versions/:version/publish', requirePermission('policy.publish'), controller.publishPolicy);
router.post('/:policyId/versions/:version/retire', requirePermission('policy.retire'), controller.retirePolicy);

module.exports = router;

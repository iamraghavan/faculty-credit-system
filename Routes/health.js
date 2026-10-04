// routes/health.js
const express = require('express');
const router = express.Router();
const healthController = require('../Controllers/healthController');

router.get('/health/live', healthController.live);
router.get('/health/ready', healthController.ready);
// Kept for existing monitors; now the same minimal readiness answer.
router.get('/api/health', healthController.ready);

module.exports = router;

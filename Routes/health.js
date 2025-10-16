// routes/health.js
const express = require('express');
const router = express.Router();
const healthController = require('../Controllers/healthController');

router.get('/api/health', healthController.apiHealth);

module.exports = router;

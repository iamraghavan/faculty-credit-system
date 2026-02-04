const express = require('express');
const router = express.Router();
const cdnController = require('../Controllers/cdnController');
// const { protect, restrictTo } = require('../Middleware/authMiddleware'); // Uncomment if protection needed

// CDN Asset Routes
// Public route to access assets
// e.g., /cdn/assets/v1/1234abc
router.get('/assets/v1/:id', cdnController.getAsset);

// Admin route to create assets
// e.g. POST /cdn/assets
// router.post('/assets', protect, restrictTo('admin'), cdnController.createAsset);
// For now, keeping public or internal for testing, enable auth later
router.post('/assets', cdnController.createAsset);


// URL Shortener Routes
// Handled here so we can mount them at root level or specific path in server.js
// But usually shortener is at root /s/:id

// Create short URL
router.post('/shorten', cdnController.createShortUrl);

module.exports = router;

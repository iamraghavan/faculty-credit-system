const express = require('express');
const router = express.Router();
const cdnController = require('../Controllers/cdnController');
const { authMiddleware, adminOnly } = require('../Middleware/authMiddleware');

// CDN Asset Routes
// Public route to access assets, e.g. /cdn/assets/v1/1234abc
router.get('/assets/v1/:id', cdnController.getAsset);

// Creating asset mappings is an administrative action (SEC-03).
router.post('/assets', authMiddleware, adminOnly, cdnController.createAsset);

// URL Shortener: only logged-in users, only for this application's own links (SEC-02).
// Mounted at /cdn/shorten and /api/v1/url/shorten; redirects are served at /s/:id.
router.post('/shorten', authMiddleware, cdnController.createShortUrl);

module.exports = router;

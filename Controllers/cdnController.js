const Asset = require('../Models/Asset');
const ShortUrl = require('../Models/ShortUrl');
const { createMaskedUrl, createShortLink } = require('../utils/urlHelper');

// Map of predefined static assets (fallback/hardcoded for critical ones if DB fails or for speed)
const STATIC_ASSETS = {
    'logo': 'https://cdn.jsdelivr.net/gh/someuser/repo/logo.png',
    // Add more as needed
};

/**
 * GET /cdn/assets/v1/:id
 * Redirects to the target URL for the asset.
 */
async function getAsset(req, res, next) {
    try {
        const { id } = req.params;

        // 1. Check hardcoded first
        if (STATIC_ASSETS[id]) {
            return res.redirect(STATIC_ASSETS[id]);
        }

        // 2. Check DB
        const asset = await Asset.findById(id);
        if (!asset) {
            return res.status(404).send('Asset not found');
        }

        // Cache control for CDN (1 day)
        res.set('Cache-Control', 'public, max-age=86400');

        // Redirect to the real source
        res.redirect(asset.targetUrl);
    } catch (err) {
        next(err);
    }
}

/**
 * POST /cdn/assets (Admin only or Internal)
 * Create a new asset mapping
 */
async function createAsset(req, res, next) {
    try {
        const { id, targetUrl, mimeType } = req.body;
        if (!targetUrl) return res.status(400).json({ success: false, message: 'targetUrl is required' });

        // Logic: If user provides ID, we use Asset.create directly.
        // If not, use utility to generate one.

        if (id) {
            // Enforce specific ID
            await Asset.create({ id, targetUrl, mimeType });
            return res.json({
                success: true,
                message: 'Asset created',
                url: `${process.env.APP_URL || 'https://fcs.egspgroup.in'}/cdn/assets/v1/${id}`
            });
        } else {
            // Generate one
            const url = await createMaskedUrl(targetUrl, mimeType);
            return res.json({ success: true, message: 'Asset created', url });
        }
    } catch (err) {
        next(err);
    }
}

/**
 * GET /s/:id
 * Short URL redirect
 */
async function getShortUrl(req, res, next) {
    try {
        const { id } = req.params;
        const short = await ShortUrl.findById(id);

        if (!short) {
            return res.status(404).send('Link not found or expired');
        }

        // Async increment
        ShortUrl.incrementVisits(id);

        res.redirect(short.originalUrl);
    } catch (err) {
        next(err);
    }
}

/**
 * POST /api/v1/shorten
 */
async function createShortUrl(req, res, next) {
    try {
        const { url, alias } = req.body;
        if (!url) return res.status(400).json({ success: false, message: 'URL is required' });

        const shortUrl = await createShortLink(url, alias);
        res.json({ success: true, shortUrl });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    getAsset,
    createAsset,
    getShortUrl,
    createShortUrl
};

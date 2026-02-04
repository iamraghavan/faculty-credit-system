const Asset = require('../Models/Asset');
const ShortUrl = require('../Models/ShortUrl');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// Helper to generate short codes (random 6 chars)
function generateShortCode() {
    return crypto.randomBytes(4).toString('hex').slice(0, 6);
}

// Map of predefined static assets (fallback/hardcoded for critical ones if DB fails or for speed)
// This serves as an immediate verified list before we fully rely on DB or for bootstrapping.
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

        // 1. Check hardcoded first (optional optimizations)
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

        // Use provided ID or generate a random one if you want "randomNum+String" style
        // If user wants specific format, we can enforce it here.
        // For now, accept custom or generate typical one.

        // If the user requested "randomNum+String", let's generate if not provided.
        let finalId = id;
        if (!finalId) {
            const randomNum = Math.floor(1000 + Math.random() * 9000); // 4 digit random
            const randomStr = crypto.randomBytes(3).toString('hex');
            finalId = `${randomNum}${randomStr}`;
        }

        const asset = await Asset.create({ id: finalId, targetUrl, mimeType });

        res.json({
            success: true,
            message: 'Asset created',
            url: `${process.env.APP_URL || 'https://fcs.egspgroup.in'}/cdn/assets/v1/${finalId}`
        });
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

        // Async increment (don't await to speed up redirect)
        ShortUrl.incrementVisits(id);

        res.redirect(short.originalUrl);
    } catch (err) {
        next(err);
    }
}

/**
 * POST /api/v1/shorten (Protected or Public depending on use case)
 */
async function createShortUrl(req, res, next) {
    try {
        const { url, alias } = req.body;
        if (!url) return res.status(400).json({ success: false, message: 'URL is required' });

        let id = alias;
        if (!id) {
            id = generateShortCode();
            // Simple collision check could be added here
        }

        // Check if ID exists if alias provided
        if (alias) {
            const existing = await ShortUrl.findById(alias);
            if (existing) {
                return res.status(400).json({ success: false, message: 'Alias already in use' });
            }
        }

        await ShortUrl.create({ id, originalUrl: url });

        res.json({
            success: true,
            shortUrl: `${process.env.APP_URL || 'https://fcs.egspgroup.in'}/s/${id}`
        });
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

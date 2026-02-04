const Asset = require('../Models/Asset');
const ShortUrl = require('../Models/ShortUrl');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Prioritize APP_URL, fallback to FRONTEND_URL, remove trailing slash
const APP_URL = (process.env.APP_URL || process.env.FRONTEND_URL || 'https://fcs.egspgroup.in').replace(/\/$/, '');

/**
 * Generate a Masked CDN URL
 * @param {string} targetUrl - The original storage URL (e.g., GitHub raw)
 * @param {string} mimeType - File mime type
 * @returns {Promise<string>} - The masked URL (e.g., /cdn/assets/v1/xyz)
 */
async function createMaskedUrl(targetUrl, mimeType = 'application/octet-stream') {
    // Generate a random ID: 4 digit number + 3 byte hex string (as requested previously)
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const randomStr = crypto.randomBytes(3).toString('hex');
    const id = `${randomNum}${randomStr}`;

    await Asset.create({ id, targetUrl, mimeType });

    return `${APP_URL}/cdn/assets/v1/${id}`;
}

/**
 * Generate a Short URL
 * @param {string} originalUrl - The URL to shorten
 * @param {string} alias - Optional custom alias
 * @returns {Promise<string>} - The short URL (e.g., /s/abc)
 */
async function createShortLink(originalUrl, alias = null) {
    let id = alias;
    if (!id) {
        // Generate 6 char random code
        id = crypto.randomBytes(4).toString('hex').slice(0, 6);
    }

    // Ensure uniqueness if generating (simple check, recursive if collision - unlikely for this scale)
    // For now, just create. DynamoDB put will overwrite if ID collides (rare with masked ID, but alias needs check)
    // If alias is provided, we assumes caller handled collision or we overwrite.

    await ShortUrl.create({ id, originalUrl });

    return `${APP_URL}/s/${id}`;
}

module.exports = {
    createMaskedUrl,
    createShortLink
};

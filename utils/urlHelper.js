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
    // 16 hex characters (64 bits) from a secure random source; Asset.create
    // refuses to overwrite, so retry on the unlikely collision.
    for (let attempt = 0; attempt < 3; attempt++) {
        const id = crypto.randomBytes(8).toString('hex');
        try {
            await Asset.create({ id, targetUrl, mimeType });
            return `${APP_URL}/cdn/assets/v1/${id}`;
        } catch (error) {
            if (error.name !== 'ConditionalCheckFailedException') throw error;
        }
    }
    throw new Error('Could not allocate a unique asset id');
}

/**
 * Generate a Short URL
 * @param {string} originalUrl - The URL to shorten
 * @param {string} alias - Optional custom alias
 * @returns {Promise<string>} - The short URL (e.g., /s/abc)
 */
async function createShortLink(originalUrl) {
    // 12 hex characters (48 bits) so links cannot practically be guessed.
    // ShortUrl.create refuses to overwrite an existing id; retry on the
    // (very unlikely) collision. Older 6-character links keep working.
    for (let attempt = 0; attempt < 3; attempt++) {
        const id = crypto.randomBytes(6).toString('hex');
        try {
            await ShortUrl.create({ id, originalUrl });
            return `${APP_URL}/s/${id}`;
        } catch (error) {
            if (error.name !== 'ConditionalCheckFailedException') throw error;
        }
    }
    throw new Error('Could not allocate a unique short link');
}

/**
 * Hosts a public short link may point to: this application's own websites
 * and the configured proof-file CDN path. Extra hosts can be allowed with
 * SHORTLINK_ALLOWED_HOSTS (comma separated).
 */
function isAllowedShortLinkTarget(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch { return false; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const ownHosts = [process.env.APP_URL, process.env.FRONTEND_URL, process.env.PUBLIC_APP_URL, 'https://fcs.egspgroup.in']
        .filter(Boolean)
        .map((u) => { try { return new URL(u).host; } catch { return null; } })
        .filter(Boolean);
    const extra = String(process.env.SHORTLINK_ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
    if ([...ownHosts, ...extra].includes(url.host)) return true;
    const owner = process.env.ASSET_GH_OWNER;
    const repo = process.env.ASSET_GH_REPO;
    return url.host === 'cdn.jsdelivr.net' && !!owner && !!repo && url.pathname.startsWith(`/gh/${owner}/${repo}@`);
}

module.exports = {
    createMaskedUrl,
    createShortLink,
    isAllowedShortLinkTarget
};

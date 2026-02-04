const path = require('path');
const fs = require('fs');
const { uploadFileToGitHub, uploadFileToGitHubBuffer } = require('./githubUpload');
const { createMaskedUrl, createShortLink } = require('./urlHelper');

/**
 * Centralized Helper: handle GitHub file upload and return proofUrl & proofMeta
 * @param {Object} file - Files object from multer
 * @param {string} folder - Destination folder in repo
 * @returns {Promise<Object>} - { proofUrl, proofMeta }
 */
async function handleFileUpload(file, folder) {
    if (!file) return {};

    const hasBuffer = !!file.buffer;
    const tmpPath = file.path; // may be undefined for memoryStorage
    const originalName = file.originalname || `upload-${Date.now()}`;
    const safeName = path.basename(originalName).replace(/[^\w.\-() ]+/g, '_').slice(0, 200);
    const destPath = `${folder}/${Date.now()}_${safeName}`;

    if (!process.env.GITHUB_TOKEN || !process.env.ASSET_GH_REPO || !process.env.ASSET_GH_OWNER) {
        if (tmpPath) {
            try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
        }
        throw new Error('GitHub upload not configured. Set ASSET_GH_OWNER, ASSET_GH_REPO, and GITHUB_TOKEN.');
    }

    try {
        let rawProofUrl;
        if (hasBuffer) {
            rawProofUrl = await uploadFileToGitHubBuffer(file.buffer, destPath, safeName);
        } else if (tmpPath) {
            rawProofUrl = await uploadFileToGitHub(tmpPath, destPath);
        } else {
            throw new Error('Uploaded file has no buffer or path.');
        }

        // Cleanup local file
        if (tmpPath) {
            try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore cleanup errors */ }
        }

        const mimeType = file.mimetype || 'application/octet-stream';

        // 1. Create Masked CDN URL (e.g. /cdn/assets/v1/1234abc)
        const maskedUrl = await createMaskedUrl(rawProofUrl, mimeType);

        // 2. Create Short URL (e.g. /s/xy9az) pointing to the Masked URL
        const shortUrl = await createShortLink(maskedUrl);

        return {
            proofUrl: shortUrl, // User requested short format here
            proofMeta: {
                originalName,
                size: file.size || (file.buffer ? file.buffer.length : undefined),
                mimeType,
                destPath,
                rawUrl: rawProofUrl, // Keep internal jsDelivr URL in meta
                maskedUrl: maskedUrl, // Keep internal masked URL in meta
                shortUrl: shortUrl
            },
        };
    } catch (err) {
        if (tmpPath) {
            try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
        }
        throw new Error('Failed to upload file to GitHub: ' + (err && err.message ? err.message : String(err)));
    }
}

module.exports = { handleFileUpload };

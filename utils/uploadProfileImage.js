// utils/uploadProfileImage.js
const { uploadFileToGitHub } = require('./githubUpload');
const fs = require('fs');

/**
 * Uploads a local file to GitHub and returns the jsDelivr URL.
 * Deletes the local file after upload.
 *
 * @param {Express.Multer.File} file - The uploaded file object from Multer
 * @param {string} folder - Optional folder inside repo, default: 'profileImages'
 * @returns {Promise<string>} - URL of uploaded file
 */
async function handleProfileImageUpload(file, folder = 'profileImages') {
  if (!file) return null;

  const localPath = file.path;
  const destPath = `${folder}/${file.filename}`;

  try {
    const url = await uploadFileToGitHub(localPath, destPath);
    return url;
  } finally {
    // Remove local file after upload, even if upload fails
    fs.unlink(localPath, () => {});
  }
}

module.exports = { handleProfileImageUpload };

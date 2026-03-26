// utils/uploadProfileImage.js
const { uploadFileToGitHub } = require('./githubUpload');

/**
 * Uploads a file buffer to GitHub and returns the jsDelivr URL
 * @param {Express.Multer.File} file
 * @param {string} folder
 */
async function handleProfileImageUpload(file, folder = 'profileImages') {
  if (!file) return null;

  const originalName = file.originalname || file.name || file.originalFilename || 'image.png';
  const destPath = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e9)}-${originalName}`;

  // If we have a buffer (Multer), use uploadFileToGitHubBuffer
  if (file.buffer) {
    const { uploadFileToGitHubBuffer } = require('./githubUpload');
    return await uploadFileToGitHubBuffer(file.buffer, destPath);
  }

  // If we have a path (Formidable), use uploadFileToGitHub
  const localPath = file.filepath || file.path;
  if (localPath) {
    const { uploadFileToGitHub } = require('./githubUpload');
    return await uploadFileToGitHub(localPath, destPath);
  }

  throw new Error('Invalid file object: no buffer or path found');
}

module.exports = { handleProfileImageUpload };

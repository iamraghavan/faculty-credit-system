const { uploadFileToGitHubBuffer } = require('./githubUpload');

/**
 * Uploads an image buffer to GitHub and returns the jsDelivr URL.
 *
 * @param {Express.Multer.File} file - The uploaded file object from Multer
 * @param {string} folder - Optional folder inside repo, default: 'profileImages'
 * @returns {Promise<string>} - URL of uploaded file
 */
async function handleProfileImageUpload(file, folder = 'profileImages') {
  if (!file || !file.buffer) return null;

  const destPath = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;

  // upload buffer directly
  const url = await uploadFileToGitHubBuffer(file.buffer, destPath);
  return url;
}

module.exports = { handleProfileImageUpload };

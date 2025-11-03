// utils/uploadProfileImage.js
const { uploadFileToGitHub } = require('./githubUpload');

/**
 * Uploads a file buffer to GitHub and returns the jsDelivr URL
 * @param {Express.Multer.File} file
 * @param {string} folder
 */
async function handleProfileImageUpload(file, folder = 'profileImages') {
  if (!file) return null;

  const destPath = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e9)}${file.originalname}`;

  // Upload using buffer
  const url = await uploadFileToGitHub(file.buffer, destPath, file.originalname);
  return url;
}

module.exports = { handleProfileImageUpload };

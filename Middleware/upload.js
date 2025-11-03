// Middleware/upload.js
const multer = require('multer');
const path = require('path');

// Use memory storage to avoid disk writes
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  fileFilter(req, file, cb) {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error('Only image files are allowed (jpg, png, gif)'));
    }
    cb(null, true);
  }
});

module.exports = upload;

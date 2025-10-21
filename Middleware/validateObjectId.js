// Middleware/validateObjectId.js
const mongoose = require('mongoose');

function validateObjectId(paramName) {
  return (req, res, next) => {
    const id = req.params[paramName];
    if (!id) return res.status(400).json({ success: false, message: `Missing ${paramName}` });
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, message: `Invalid ${paramName}` });
    return next();
  };
}

module.exports = validateObjectId;

// Middleware/apiKeyMiddleware.js
const User = require('../Models/User');

/**
 * Checks for x-api-key header and attaches req.apiUser
 */
async function apiKeyMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) {
    return res.status(401).json({ success: false, message: 'Missing API key' });
  }

  const user = await User.findOne({ apiKey }).select('-password');
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid API key' });
  }

  req.apiUser = user;
  next();
}

module.exports = apiKeyMiddleware;

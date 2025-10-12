// Middleware/rateLimitMiddleware.js
const rateLimit = require('express-rate-limit');

// Basic rate limiter for general endpoints
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min window
  max: 200, // limit each IP to 200 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, try again later',
});

module.exports = limiter;

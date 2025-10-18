// utils/auth.js
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

function signJWT(payload, opts = {}) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: opts.expiresIn || '7d' });
}

function verifyJWT(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { signJWT, verifyJWT };

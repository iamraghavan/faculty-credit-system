// api/index.js
require('../instrument'); // error tracking (no-op unless SENTRY_DSN is set)
const app = require('../server');
const { connectDB } = require('../config/db');

let isDbConnected = false;

module.exports = async (req, res) => {
  if (!isDbConnected) {
    await connectDB();
    isDbConnected = true;
  }
  return app(req, res);
};

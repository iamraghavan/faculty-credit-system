// api/index.js
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

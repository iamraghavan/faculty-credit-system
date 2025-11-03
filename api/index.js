const app = require('../server'); // your Express app
const { connectDB } = require('../config/db');

let isDbConnected = false;

module.exports = async (req, res) => {
  if (!isDbConnected) {
    await connectDB(); // connect once per cold start
    isDbConnected = true;
  }
  return app(req, res); // Vercel handles req/res
};

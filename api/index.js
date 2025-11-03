// api/index.js
const serverlessExpress = require('@vendia/serverless-express');
const app = require('../server'); // your Express app
const { connectDB } = require('../config/db');

let isDbConnected = false;

const startDb = async () => {
  if (!isDbConnected) {
    await connectDB(); // connect to DynamoDB once per cold start
    isDbConnected = true;
  }
};

module.exports = async (req, res) => {
  try {
    await startDb();
    return serverlessExpress({ app })(req, res);
  } catch (err) {
    console.error('Serverless function error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

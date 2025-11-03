const serverlessExpress = require('@vendia/serverless-express');
const app = require('../server'); // your Express app
const { connectDB } = require('../config/db');

let isDbConnected = false;

const startDb = async () => {
  if (!isDbConnected) {
    await connectDB();
    isDbConnected = true;
  }
};

const handler = async (req, res) => {
  await startDb();
  return serverlessExpress({ app })(req, res);
};

module.exports = handler;

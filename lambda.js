// lambda.js
const serverlessExpress = require('@vendia/serverless-express');
const app = require('./server'); 
const { connectDB } = require('./config/db');

let isDbConnected = false;

const startDb = async () => {
  if (!isDbConnected) {
    await connectDB();
    isDbConnected = true;
  }
};

const handler = async (event, context) => {
  await startDb(); // connect to DynamoDB once per cold start
  return serverlessExpress({ app })(event, context);
};

module.exports = { handler };

// config/db.js
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

let dynamoDocClient;

/**
 * Connect to DynamoDB
 */
const connectDB = async () => {
  if (dynamoDocClient) return dynamoDocClient; // already connected

  // In production, prefer an IAM role/workload identity. The AWS SDK default
  // provider chain obtains short-lived credentials without storing secrets.
  const explicitCredentials =
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined;

  const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    ...(explicitCredentials ? { credentials: explicitCredentials } : {}),
  });

  dynamoDocClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });

  console.log(`DynamoDB client configured (${process.env.AWS_REGION}); credentials are checked on the first request`);
  return dynamoDocClient;
};

/**
 * Get DynamoDB Document Client
 */
const getDynamoClient = () => {
  if (!dynamoDocClient) {
    throw new Error('DynamoDB client not initialized. Call connectDB first.');
  }
  return dynamoDocClient;
};

module.exports = { connectDB, getDynamoClient };

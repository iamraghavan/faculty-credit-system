// config/db.js
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

let dynamoDocClient;

/**
 * Connect to DynamoDB
 */
const connectDB = async () => {
  if (dynamoDocClient) return dynamoDocClient; // already connected

  const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  dynamoDocClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });

  console.log(`✅ Connected to DynamoDB (${process.env.AWS_REGION})`);
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

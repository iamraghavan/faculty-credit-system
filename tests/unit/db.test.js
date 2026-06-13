const { connectDB, getDynamoClient } = require('../../config/db');

// Mock the AWS SDK
jest.mock('@aws-sdk/client-dynamodb', () => {
  return {
    DynamoDBClient: jest.fn().mockImplementation(() => {
      return {};
    })
  };
});

jest.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => {
        return {
          send: jest.fn()
        };
      })
    }
  };
});

describe('Database Configuration', () => {
  beforeEach(() => {
    jest.resetModules(); // clears the require cache
  });

  it('should initialize and return DynamoDB client', async () => {
    const { connectDB, getDynamoClient } = require('../../config/db');
    
    const client = await connectDB();
    expect(client).toBeDefined();
    expect(getDynamoClient()).toBe(client);
  });

  it('should throw if getDynamoClient is called before connectDB', () => {
    const { getDynamoClient } = require('../../config/db');
    expect(() => getDynamoClient()).toThrow('DynamoDB client not initialized. Call connectDB first.');
  });
});

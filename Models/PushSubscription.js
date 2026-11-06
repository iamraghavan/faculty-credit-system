const { getDynamoClient } = require('../config/db');
const { PutCommand, QueryCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
require('dotenv').config();

const TABLE = process.env.DYNAMO_DB_SUBSCRIPTIONS || 'PushSubscriptions';

module.exports = {
  /**
   * Create or Update Subscription
   * @param {Object} subscription - { endpoint, keys: { p256dh, auth }, userId, userAgent }
   */
  async create(data) {
    const client = getDynamoClient();
    // Use endpoint as partition key as it is unique per device/browser
    const item = {
      endpoint: data.endpoint,
      keys: data.keys,
      userId: data.userId,
      userAgent: data.userAgent || 'Unknown',
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    await client.send(
      new PutCommand({
        TableName: TABLE,
        Item: item,
        ConditionExpression: 'attribute_not_exists(#endpoint) OR #owner = :owner',
        ExpressionAttributeNames: { '#endpoint': 'endpoint', '#owner': 'userId' },
        ExpressionAttributeValues: { ':owner': data.userId },
      }),
    );
    return item;
  },

  /**
   * Find all subscriptions for a userId
   */
  async findByUserId(userId) {
    const client = getDynamoClient();
    // Ideally use a GSI on userId. If not, we have to scan (inefficient) or structure the table differently.
    // For now, assuming low volume or GSI exists. Let's use Scan with filter for simplicity in this dev phase,
    // BUT strictly, we should assume a GSI named 'UserIdIndex' if we were strictly following DynamoDB patterns.
    // Given the constraints and previous patterns, a Scan filter is safe enough for small scale.

    // Better: If we can't ensure GSI, let's just Scan. A real prod app needs GSI.
    const params = {
      TableName: TABLE,
      FilterExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    };

    const res = await client.send(new ScanCommand(params));
    return (res.Items || []).filter((item) => item.isActive !== false);
  },

  /**
   * Delete a subscription (e.g., if invalid/expired)
   */
  async delete(endpoint) {
    const client = getDynamoClient();
    await client.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { endpoint },
        UpdateExpression: 'SET isActive = :inactive, archivedAt = :at',
        ConditionExpression: 'attribute_exists(endpoint)',
        ExpressionAttributeValues: { ':inactive': false, ':at': new Date().toISOString() },
      }),
    );
    return { archived: true };
  },

  /**
   * Get all active subscriptions (for broadcasting)
   */
  async getAll() {
    const client = getDynamoClient();
    const res = await client.send(new ScanCommand({ TableName: TABLE }));
    return (res.Items || []).filter((item) => item.isActive !== false);
  },
};

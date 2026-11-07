const { PutCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { getDynamoClient } = require('../config/db');
const { newObjectId } = require('../utils/objectId');

function tableName() {
  const TABLE = process.env.DYNAMO_DB_NOTIFICATIONS;
  if (!TABLE) {
    const error = new Error('DYNAMO_DB_NOTIFICATIONS is not configured');
    error.name = 'StorageConfigurationError';
    throw error;
  }
  return TABLE;
}

module.exports = {
  async create(data) {
    const now = new Date().toISOString();
    const item = {
      _id: newObjectId(),
      userId: String(data.userId),
      type: data.type || 'general',
      title: String(data.title || 'Notification'),
      message: String(data.message || data.body || ''),
      url: data.url || null,
      icon: data.icon || null,
      read: false,
      channels: data.channels || {},
      metadata: data.metadata || {},
      createdAt: now,
      updatedAt: now,
    };
    await getDynamoClient().send(new PutCommand({ TableName: tableName(), Item: item }));
    return item;
  },
  async findById(id) {
    const result = await getDynamoClient().send(new GetCommand({ TableName: tableName(), Key: { _id: id } }));
    return result.Item || null;
  },
  async findByUserId(userId, limit = 100) {
    const items = [];
    let ExclusiveStartKey;
    do {
      const result = await getDynamoClient().send(
        new ScanCommand({
          TableName: tableName(),
          ExclusiveStartKey,
          FilterExpression: 'userId = :userId',
          ExpressionAttributeValues: { ':userId': String(userId) },
        }),
      );
      items.push(...(result.Items || []));
      ExclusiveStartKey = result.LastEvaluatedKey;
    } while (ExclusiveStartKey && items.length < limit);
    return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
  },
  async markRead(id, userId) {
    const result = await getDynamoClient().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { _id: id },
        UpdateExpression: 'SET #read = :true, readAt = :now, updatedAt = :now',
        ConditionExpression: 'userId = :userId',
        ExpressionAttributeNames: { '#read': 'read' },
        ExpressionAttributeValues: { ':true': true, ':now': new Date().toISOString(), ':userId': String(userId) },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return result.Attributes;
  },
};

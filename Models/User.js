const { newObjectId } = require('../utils/objectId');
const { getDynamoClient } = require('../config/db');
require('dotenv').config();
const {
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.DYNAMO_DB_USERS;

module.exports = {
  /**
   * Create a new user
   */
  async create(data) {
    const client = getDynamoClient();

    const item = {
      _id: newObjectId(),
      prefix: data.prefix || 'Mr.',
      isActive: data.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),

      // Optional password reset fields (default null)
      resetPasswordToken: data.resetPasswordToken || null,
      resetPasswordExpires: data.resetPasswordExpires || null,

      // WhatsApp fields
      whatsappNumber: data.whatsappNumber || null,
      whatsappVerified: data.whatsappVerified ?? false,
      whatsappOtp: null,
      whatsappOtpExpires: null,

      // MFA fields
      mfaEnabled: data.mfaEnabled ?? false,
      mfaEmailEnabled: data.mfaEmailEnabled ?? false,
      mfaAppEnabled: data.mfaAppEnabled ?? false,
      mfaSecret: data.mfaSecret || null,
      mfaCode: data.mfaCode || null,
      mfaCodeExpires: data.mfaCodeExpires || null,

      ...data,
    };

    await client.send(new PutCommand({ TableName: TABLE, Item: item }));
    return item;
  },

  /**
   * Find users (simple Scan + filter)
   */
  async find(filter = {}) {
    const client = getDynamoClient();
    const res = await client.send(new ScanCommand({ TableName: TABLE }));
    const items = res.Items || [];

    return items.filter((u) =>
      Object.entries(filter).every(([k, v]) => u[k] === v)
    );
  },

  /**
   * Find user by ID
   */
  async findById(id) {
    const client = getDynamoClient();
    const res = await client.send(
      new GetCommand({ TableName: TABLE, Key: { _id: id } })
    );
    return res.Item || null;
  },

  /**
   * Update user by ID
   */
  async update(id, data) {
    if (!data || Object.keys(data).length === 0) return null;

    const client = getDynamoClient();

    const updates = Object.keys(data).map((k) => `#${k} = :${k}`);
    const expNames = Object.fromEntries(Object.keys(data).map((k) => [`#${k}`, k]));
    const expValues = Object.fromEntries(Object.entries(data).map(([k, v]) => [`:${k}`, v]));

    await client.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { _id: id },
        UpdateExpression: `SET ${updates.join(', ')}`,
        ExpressionAttributeNames: expNames,
        ExpressionAttributeValues: expValues,
      })
    );

    return { _id: id, ...data };
  },

  /**
   * Delete user by ID
   */
  async delete(id) {
    const client = getDynamoClient();
    await client.send(
      new DeleteCommand({ TableName: TABLE, Key: { _id: id } })
    );
    return { deleted: true };
  },
};

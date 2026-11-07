const { newObjectId } = require('../utils/objectId');
const { getDynamoClient } = require('../config/db');
require('dotenv').config();
const { PutCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

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

      // Firebase / Push Notification
      fcmToken: data.fcmToken || null,

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
    const params = { TableName: TABLE };

    const filterKeys = Object.keys(filter);
    if (filterKeys.length > 0) {
      const filterExps = [];
      const expNames = {};
      const expValues = {};

      filterKeys.forEach((k) => {
        expNames[`#${k}`] = k;
        expValues[`:${k}`] = filter[k];
        filterExps.push(`#${k} = :${k}`);
      });

      params.FilterExpression = filterExps.join(' AND ');
      params.ExpressionAttributeNames = expNames;
      params.ExpressionAttributeValues = expValues;
    }

    const items = [];
    let lastEvaluatedKey = undefined;
    do {
      params.ExclusiveStartKey = lastEvaluatedKey;
      const res = await client.send(new ScanCommand(params));
      if (res.Items) {
        items.push(...res.Items);
      }
      lastEvaluatedKey = res.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return items;
  },

  /**
   * Find user by ID
   */
  async findById(id) {
    const client = getDynamoClient();
    const res = await client.send(new GetCommand({ TableName: TABLE, Key: { _id: id } }));
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
      }),
    );

    return { _id: id, ...data };
  },

  async updateFcmDevices(id, previous, devices) {
    const hasPrevious = Array.isArray(previous);
    const result = await getDynamoClient().send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { _id: id },
        UpdateExpression: 'SET #devices = :devices',
        ConditionExpression:
          'attribute_exists(#id) AND ' + (hasPrevious ? '#devices = :previous' : 'attribute_not_exists(#devices)'),
        ExpressionAttributeNames: { '#devices': 'fcmDevices', '#id': '_id' },
        ExpressionAttributeValues: { ':devices': devices, ...(hasPrevious ? { ':previous': previous } : {}) },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return result.Attributes;
  },

  // Placement and its history change together. A stale form cannot overwrite a transfer.
  async updateCompared(user, data) {
    const fields = Object.keys(data);
    const names = Object.fromEntries(fields.map((key, i) => [`#f${i}`, key]));
    const values = Object.fromEntries(fields.map((key, i) => [`:v${i}`, data[key]]));
    const conditions = [];
    for (const [index, key] of ['updatedAt', 'college', 'department'].entries()) {
      names[`#old${index}`] = key;
      if (user[key] === undefined) conditions.push(`attribute_not_exists(#old${index})`);
      else {
        conditions.push(`#old${index} = :old${index}`);
        values[`:old${index}`] = user[key];
      }
    }
    const result = await getDynamoClient().send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { _id: String(user._id) },
        UpdateExpression: `SET ${fields.map((_, i) => `#f${i} = :v${i}`).join(', ')}`,
        ConditionExpression: conditions.join(' AND '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return result.Attributes;
  },

  /**
   * Delete user by ID
   */
  async delete(id) {
    throw new Error(`Physical deletion of user ${id} is disabled; deactivate the account instead`);
  },
};

// models/CreditTitle.js
const { newObjectId } = require('../utils/objectId');
const { getDynamoClient } = require('../config/db');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
require('dotenv').config();
const TABLE = process.env.DYNAMO_DB_TITLES;

module.exports = {
  async create(data) {
    const client = getDynamoClient();
    const item = {
      _id: newObjectId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...data,
    };
    await client.send(new PutCommand({ TableName: TABLE, Item: item }));
    return item;
  },

  async find(filter = {}) {
    const client = getDynamoClient();
    const res = await client.send(new ScanCommand({ TableName: TABLE }));
    return res.Items.filter((t) =>
      Object.entries(filter).every(([k, v]) => t[k] === v)
    );
  },

  async findById(id) {
    const client = getDynamoClient();
    const res = await client.send(new GetCommand({ TableName: TABLE, Key: { _id: id } }));
    return res.Item || null;
  },

  async update(id, data) {
    const client = getDynamoClient();
    const updates = Object.entries(data).map(([k, v]) => `#${k} = :${k}`);
    const expNames = Object.fromEntries(Object.keys(data).map((k) => [`#${k}`, k]));
    const expValues = Object.fromEntries(Object.entries(data).map(([k, v]) => [`:${k}`, v]));

    await client.send(new UpdateCommand({
      TableName: TABLE,
      Key: { _id: id },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeNames: expNames,
      ExpressionAttributeValues: expValues,
    }));
    return { _id: id, ...data };
  },

  async delete(id) {
    const client = getDynamoClient();
    await client.send(new DeleteCommand({ TableName: TABLE, Key: { _id: id } }));
    return { deleted: true };
  },
};

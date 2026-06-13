// models/Credit.js
const { newObjectId } = require('../utils/objectId');
const { getDynamoClient } = require('../config/db');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.DYNAMO_DB_CREDITS;

module.exports = {
  async create(data) {
    const client = getDynamoClient();
    const item = {
      _id: newObjectId(),
      status: data.status || 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...data,
    };
    await client.send(new PutCommand({ TableName: TABLE, Item: item }));
    console.log(`[Credit Model] Successfully stored credit entry: ${item._id} for faculty: ${item.faculty}`);
    return item;
  },

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

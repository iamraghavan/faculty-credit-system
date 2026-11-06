const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { getDynamoClient } = require('../config/db');

// A reserved configuration record in the existing configuration/policies table.
const KEY = 'application-settings';
module.exports = {
  async get() {
    const result = await getDynamoClient().send(
      new GetCommand({
        TableName: process.env.DYNAMO_DB_POLICIES,
        Key: { _id: KEY },
        ConsistentRead: true,
      }),
    );
    return result.Item || null;
  },
  async save(data, revision) {
    const item = { ...data, _id: KEY, recordType: 'application-settings', revision: revision + 1 };
    await getDynamoClient().send(
      new PutCommand({
        TableName: process.env.DYNAMO_DB_POLICIES,
        Item: item,
        ConditionExpression: revision === 0 ? 'attribute_not_exists(#id)' : '#revision = :revision',
        ExpressionAttributeNames: revision === 0 ? { '#id': '_id' } : { '#revision': 'revision' },
        ...(revision === 0 ? {} : { ExpressionAttributeValues: { ':revision': revision } }),
      }),
    );
    return item;
  },
};

const { getDynamoClient } = require('../config/db');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.DYNAMO_DB_POLICIES;

function tableName() {
  if (!TABLE) {
    const error = new Error('DYNAMO_DB_POLICIES is not configured');
    error.status = 503;
    throw error;
  }
  return TABLE;
}

module.exports = {
  key(policyId, version) { return `${policyId}#v${String(version).padStart(6, '0')}`; },
  async create(item) {
    const record = { ...item, _id: this.key(item.policyId, item.version) };
    await getDynamoClient().send(new PutCommand({
      TableName: tableName(), Item: record,
      ConditionExpression: 'attribute_not_exists(#id)', ExpressionAttributeNames: { '#id': '_id' },
    }));
    return record;
  },
  async findByVersion(policyId, version) {
    const result = await getDynamoClient().send(new GetCommand({ TableName: tableName(), Key: { _id: this.key(policyId, version) } }));
    return result.Item || null;
  },
  async find(filter = {}) {
    const values = {};
    const names = {};
    const expressions = [];
    Object.entries(filter).forEach(([key, value]) => {
      names[`#${key}`] = key; values[`:${key}`] = value; expressions.push(`#${key} = :${key}`);
    });
    const items = [];
    let ExclusiveStartKey;
    do {
      const result = await getDynamoClient().send(new ScanCommand({
        TableName: tableName(), ExclusiveStartKey,
        ...(expressions.length ? { FilterExpression: expressions.join(' AND '), ExpressionAttributeNames: names, ExpressionAttributeValues: values } : {}),
      }));
      items.push(...(result.Items || []));
      ExclusiveStartKey = result.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  },
  async updateDraft(policyId, version, changes, expectedRevision) {
    const mutable = ['name', 'description', 'effectiveFrom', 'effectiveTo', 'timezone', 'scope', 'rules'];
    const data = Object.fromEntries(Object.entries(changes).filter(([key]) => mutable.includes(key)));
    const names = { '#status': 'status', '#revision': 'revision', '#updatedAt': 'updatedAt' };
    const values = { ':draft': 'draft', ':expected': expectedRevision, ':next': expectedRevision + 1, ':updatedAt': new Date().toISOString() };
    const sets = ['#revision = :next', '#updatedAt = :updatedAt'];
    Object.entries(data).forEach(([key, value], index) => {
      names[`#field${index}`] = key; values[`:field${index}`] = value; sets.push(`#field${index} = :field${index}`);
    });
    const result = await getDynamoClient().send(new UpdateCommand({
      TableName: tableName(), Key: { _id: this.key(policyId, version) },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: '#status = :draft AND #revision = :expected',
      ExpressionAttributeNames: names, ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }));
    return result.Attributes;
  },
  async changeStatus(policyId, version, fromStatus, status, metadata = {}) {
    const names = { '#status': 'status', '#updatedAt': 'updatedAt' };
    const values = { ':from': fromStatus, ':status': status, ':updatedAt': new Date().toISOString() };
    const sets = ['#status = :status', '#updatedAt = :updatedAt'];
    Object.entries(metadata).forEach(([key, value], index) => {
      names[`#meta${index}`] = key; values[`:meta${index}`] = value; sets.push(`#meta${index} = :meta${index}`);
    });
    const result = await getDynamoClient().send(new UpdateCommand({
      TableName: tableName(), Key: { _id: this.key(policyId, version) },
      UpdateExpression: `SET ${sets.join(', ')}`, ConditionExpression: '#status = :from',
      ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: 'ALL_NEW',
    }));
    return result.Attributes;
  },
};

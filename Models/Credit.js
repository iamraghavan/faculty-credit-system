// models/Credit.js
const { newObjectId } = require('../utils/objectId');
const { getDynamoClient } = require('../config/db');
const { PutCommand, GetCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

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

  async decideAppeal(id, { decision, notes, creditStatus, reviewedBy }) {
    const client = getDynamoClient();
    const now = new Date().toISOString();
    const names = {
      '#appeal': 'appeal', '#appealStatus': 'status', '#appealUpdatedAt': 'updatedAt',
      '#status': 'status', '#updatedAt': 'updatedAt',
    };
    const values = { ':pending': 'pending', ':decision': decision, ':creditStatus': creditStatus, ':now': now, ':deleted': 'deleted' };
    let update = 'SET #appeal.#appealStatus = :decision, #appeal.#appealUpdatedAt = :now, #status = :creditStatus, #updatedAt = :now';
    if (notes) {
      names['#notes'] = 'notes';
      values[':notes'] = notes;
      update += ', #appeal.#notes = :notes';
    }
    if (reviewedBy) {
      names['#reviewedBy'] = 'reviewedBy';
      values[':reviewedBy'] = String(reviewedBy);
      update += ', #appeal.#reviewedBy = :reviewedBy';
    }
    const response = await client.send(new UpdateCommand({
      TableName: TABLE,
      Key: { _id: id },
      UpdateExpression: update,
      ConditionExpression: '#appeal.#appealStatus = :pending AND #status <> :deleted',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }));
    return response.Attributes;
  },

  async updateOwned(id, ownerId, changes, event, expectedUpdatedAt) {
    const client = getDynamoClient();
    const entries = Object.entries(changes);
    const names = { '#issuer': 'issuedBy', '#status': 'status', '#updatedAt': 'updatedAt', '#activity': 'activityLog' };
    const values = { ':owner': String(ownerId), ':deleted': 'deleted', ':empty': [], ':events': [event] };
    const sets = entries.map(([field, value], index) => {
      names[`#field${index}`] = field;
      values[`:value${index}`] = value;
      return `#field${index} = :value${index}`;
    });
    values[':expectedUpdatedAt'] = expectedUpdatedAt || '';
    const response = await client.send(new UpdateCommand({
      TableName: TABLE,
      Key: { _id: id },
      UpdateExpression: `SET ${sets.join(', ')}, #activity = list_append(if_not_exists(#activity, :empty), :events)`,
      ConditionExpression: '#issuer = :owner AND #status <> :deleted AND (attribute_not_exists(#updatedAt) OR #updatedAt = :expectedUpdatedAt)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }));
    return response.Attributes;
  },

  async voidByActor(id, actorId, expectedUpdatedAt, event) {
    const client = getDynamoClient();
    const now = new Date().toISOString();
    const response = await client.send(new UpdateCommand({
      TableName: TABLE,
      Key: { _id: id },
      UpdateExpression: 'SET #status = :deleted, #deletedAt = :now, #deletedBy = :actor, #updatedAt = :now, #activity = list_append(if_not_exists(#activity, :empty), :events)',
      ConditionExpression: 'attribute_exists(#id) AND #status <> :deleted AND (attribute_not_exists(#updatedAt) OR #updatedAt = :expectedUpdatedAt)',
      ExpressionAttributeNames: { '#id': '_id', '#status': 'status', '#deletedAt': 'deletedAt', '#deletedBy': 'deletedBy', '#updatedAt': 'updatedAt', '#activity': 'activityLog' },
      ExpressionAttributeValues: { ':deleted': 'deleted', ':now': now, ':actor': String(actorId), ':empty': [],
        ':events': [{ ...event, action: 'voided', actorId: String(actorId), at: now }], ':expectedUpdatedAt': expectedUpdatedAt || '' },
      ReturnValues: 'ALL_NEW',
    }));
    return response.Attributes;
  },

  async delete(id) {
    throw new Error(`Physical deletion of credit ${id} is disabled; void the record instead`);
  },
};

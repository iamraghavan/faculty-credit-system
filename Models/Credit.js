// models/Credit.js (replace/extend the existing file)
const { newObjectId } = require('../utils/objectId');
const { getDynamoClient } = require('../config/db');
const {
  PutCommand,
  GetCommand,
  ScanCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.DYNAMO_DB_CREDITS;
const GSI_TYPE_FACULTY = process.env.DYNAMO_GSI_TYPE_FACULTY || 'TypeFacultyIndex'; // optional, recommended

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
    return item;
  },

  async findById(id) {
    const client = getDynamoClient();
    const res = await client.send(new GetCommand({ TableName: TABLE, Key: { _id: id } }));
    return res.Item || null;
  },

  async update(id, data) {
    const client = getDynamoClient();
    const updates = Object.entries(data).map(([k]) => `#${k} = :${k}`);
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

  /**
   * Advanced find with server-side filtering where possible.
   * filter: simple equality filters (e.g. { type: 'positive', faculty: '123' })
   * advanced: object with optional keys:
   *   status: [ 'approved', 'pending' ]
   *   fromDate, toDate (ISO strings) on createdAt
   *   pointsMin, pointsMax (numbers)
   *   categories: ['cat1','cat2']
   *   creditTitle, issuedBy
   *   hasProof: boolean (true => proofUrl exists, false => not)
   *   search: string (will still require some client-side filtering)
   * opts:
   *   limit: number
   *   lastKey: a Dynamo ExclusiveStartKey (object) OR base64 encoded token (string)
   *
   * Returns: { items: [...], lastEvaluatedKey: <object|null> }
   */
  async findAdvanced(filter = {}, advanced = {}, opts = {}) {
    const client = getDynamoClient();
    const limit = Math.max(1, Math.min(1000, Number(opts.limit) || 20));

    // Allow lastKey as base64 token
    let ExclusiveStartKey = null;
    if (opts.lastKey) {
      try {
        const decoded = typeof opts.lastKey === 'string' ? JSON.parse(Buffer.from(opts.lastKey, 'base64').toString('utf8')) : opts.lastKey;
        ExclusiveStartKey = decoded;
      } catch (e) {
        // ignore invalid token; treat as null
        ExclusiveStartKey = null;
      }
    }

    // Try to use Query on a GSI if we have both type and faculty (fast path)
    const canUseTypeFacultyGSI = filter.type && filter.faculty && process.env.DYNAMO_GSI_TYPE_FACULTY;

    if (canUseTypeFacultyGSI) {
      // This assumes you created a GSI where partitionKey = type, sortKey = faculty (or similar).
      // Adjust KeyConditionExpression according to your GSI schema.
      const params = {
        TableName: TABLE,
        IndexName: GSI_TYPE_FACULTY,
        KeyConditionExpression: '#type = :type and #faculty = :faculty',
        ExpressionAttributeNames: { '#type': 'type', '#faculty': 'faculty' },
        ExpressionAttributeValues: { ':type': filter.type, ':faculty': filter.faculty },
        Limit: limit,
        ExclusiveStartKey,
      };

      // We can still apply FilterExpression for additional conditions that are not part of key
      const filterParts = [];
      const attrNames = params.ExpressionAttributeNames;
      const attrValues = params.ExpressionAttributeValues;

      if (advanced.status && Array.isArray(advanced.status) && advanced.status.length) {
        filterParts.push(`( ${advanced.status.map((s, i) => `#status = :status${i}`).join(' OR ')} )`);
        attrNames['#status'] = 'status';
        advanced.status.forEach((s, i) => { attrValues[`:status${i}`] = s; });
      }

      if (advanced.fromDate && advanced.toDate) {
        filterParts.push('#createdAt BETWEEN :fromDate AND :toDate');
        attrNames['#createdAt'] = 'createdAt';
        attrValues[':fromDate'] = advanced.fromDate;
        attrValues[':toDate'] = advanced.toDate;
      } else if (advanced.fromDate) {
        filterParts.push('#createdAt >= :fromDate');
        attrNames['#createdAt'] = 'createdAt';
        attrValues[':fromDate'] = advanced.fromDate;
      } else if (advanced.toDate) {
        filterParts.push('#createdAt <= :toDate');
        attrNames['#createdAt'] = 'createdAt';
        attrValues[':toDate'] = advanced.toDate;
      }

      if (typeof advanced.hasProof === 'boolean') {
        if (advanced.hasProof) {
          filterParts.push('attribute_exists(#proofUrl) AND #proofUrl <> :empty');
          attrNames['#proofUrl'] = 'proofUrl';
          attrValues[':empty'] = '';
        } else {
          filterParts.push('attribute_not_exists(#proofUrl) OR #proofUrl = :empty');
          attrNames['#proofUrl'] = 'proofUrl';
          attrValues[':empty'] = '';
        }
      }

      if (advanced.pointsMin != null || advanced.pointsMax != null) {
        if (advanced.pointsMin != null && advanced.pointsMax != null) {
          filterParts.push('#points BETWEEN :pmin AND :pmax');
          attrNames['#points'] = 'points';
          attrValues[':pmin'] = Number(advanced.pointsMin);
          attrValues[':pmax'] = Number(advanced.pointsMax);
        } else if (advanced.pointsMin != null) {
          filterParts.push('#points >= :pmin');
          attrNames['#points'] = 'points';
          attrValues[':pmin'] = Number(advanced.pointsMin);
        } else if (advanced.pointsMax != null) {
          filterParts.push('#points <= :pmax');
          attrNames['#points'] = 'points';
          attrValues[':pmax'] = Number(advanced.pointsMax);
        }
      }

      if (advanced.creditTitle) {
        filterParts.push('#creditTitle = :creditTitle');
        attrNames['#creditTitle'] = 'creditTitle';
        attrValues[':creditTitle'] = advanced.creditTitle;
      }

      if (advanced.issuedBy) {
        filterParts.push('#issuedBy = :issuedBy');
        attrNames['#issuedBy'] = 'issuedBy';
        attrValues[':issuedBy'] = advanced.issuedBy;
      }

      if (advanced.categories && advanced.categories.length) {
        // Dynamo cannot do "array contains any of X" easily in filter; we check that categories attribute contains any of provided values
        // Use ORed contains() checks
        const catParts = advanced.categories.map((c, i) => `contains(#categories, :cat${i})`);
        filterParts.push(`(${catParts.join(' OR ')})`);
        attrNames['#categories'] = 'categories';
        advanced.categories.forEach((c, i) => { attrValues[`:cat${i}`] = c; });
      }

      if (filterParts.length) {
        params.FilterExpression = filterParts.join(' AND ');
        params.ExpressionAttributeNames = attrNames;
        params.ExpressionAttributeValues = attrValues;
      }

      const resp = await client.send(new QueryCommand(params));
      return { items: resp.Items || [], lastEvaluatedKey: resp.LastEvaluatedKey || null };
    }

    // If we can't Query on a GSI, do a Scan with server-side FilterExpression (still better than in-memory filtering)
    {
      const params = {
        TableName: TABLE,
        Limit: limit,
        ExclusiveStartKey,
      };

      const filterParts = [];
      const ExpressionAttributeNames = {};
      const ExpressionAttributeValues = {};

      // equality filters from 'filter' param
      for (const [k, v] of Object.entries(filter)) {
        if (v == null) continue;
        filterParts.push(`#${k} = :${k}`);
        ExpressionAttributeNames[`#${k}`] = k;
        ExpressionAttributeValues[`:${k}`] = v;
      }

      // advanced filters
      if (advanced.status && Array.isArray(advanced.status) && advanced.status.length) {
        // OR them
        const statuses = advanced.status;
        const statusParts = statuses.map((s, i) => `#status = :status${i}`);
        filterParts.push(`(${statusParts.join(' OR ')})`);
        ExpressionAttributeNames['#status'] = 'status';
        statuses.forEach((s, i) => { ExpressionAttributeValues[`:status${i}`] = s; });
      }

      if (advanced.fromDate && advanced.toDate) {
        filterParts.push('#createdAt BETWEEN :fromDate AND :toDate');
        ExpressionAttributeNames['#createdAt'] = 'createdAt';
        ExpressionAttributeValues[':fromDate'] = advanced.fromDate;
        ExpressionAttributeValues[':toDate'] = advanced.toDate;
      } else if (advanced.fromDate) {
        filterParts.push('#createdAt >= :fromDate');
        ExpressionAttributeNames['#createdAt'] = 'createdAt';
        ExpressionAttributeValues[':fromDate'] = advanced.fromDate;
      } else if (advanced.toDate) {
        filterParts.push('#createdAt <= :toDate');
        ExpressionAttributeNames['#createdAt'] = 'createdAt';
        ExpressionAttributeValues[':toDate'] = advanced.toDate;
      }

      if (typeof advanced.hasProof === 'boolean') {
        if (advanced.hasProof) {
          filterParts.push('attribute_exists(#proofUrl) AND #proofUrl <> :empty');
          ExpressionAttributeNames['#proofUrl'] = 'proofUrl';
          ExpressionAttributeValues[':empty'] = '';
        } else {
          filterParts.push('attribute_not_exists(#proofUrl) OR #proofUrl = :empty');
          ExpressionAttributeNames['#proofUrl'] = 'proofUrl';
          ExpressionAttributeValues[':empty'] = '';
        }
      }

      if (advanced.pointsMin != null || advanced.pointsMax != null) {
        if (advanced.pointsMin != null && advanced.pointsMax != null) {
          filterParts.push('#points BETWEEN :pmin AND :pmax');
          ExpressionAttributeNames['#points'] = 'points';
          ExpressionAttributeValues[':pmin'] = Number(advanced.pointsMin);
          ExpressionAttributeValues[':pmax'] = Number(advanced.pointsMax);
        } else if (advanced.pointsMin != null) {
          filterParts.push('#points >= :pmin');
          ExpressionAttributeNames['#points'] = 'points';
          ExpressionAttributeValues[':pmin'] = Number(advanced.pointsMin);
        } else if (advanced.pointsMax != null) {
          filterParts.push('#points <= :pmax');
          ExpressionAttributeNames['#points'] = 'points';
          ExpressionAttributeValues[':pmax'] = Number(advanced.pointsMax);
        }
      }

      if (advanced.creditTitle) {
        filterParts.push('#creditTitle = :creditTitle');
        ExpressionAttributeNames['#creditTitle'] = 'creditTitle';
        ExpressionAttributeValues[':creditTitle'] = advanced.creditTitle;
      }

      if (advanced.issuedBy) {
        filterParts.push('#issuedBy = :issuedBy');
        ExpressionAttributeNames['#issuedBy'] = 'issuedBy';
        ExpressionAttributeValues[':issuedBy'] = advanced.issuedBy;
      }

      if (advanced.categories && advanced.categories.length) {
        const catParts = advanced.categories.map((c, i) => `contains(#categories, :cat${i})`);
        filterParts.push(`(${catParts.join(' OR ')})`);
        ExpressionAttributeNames['#categories'] = 'categories';
        advanced.categories.forEach((c, i) => { ExpressionAttributeValues[`:cat${i}`] = c; });
      }

      if (filterParts.length) {
        params.FilterExpression = filterParts.join(' AND ');
        params.ExpressionAttributeNames = ExpressionAttributeNames;
        params.ExpressionAttributeValues = ExpressionAttributeValues;
      }

      const resp = await client.send(new ScanCommand(params));
      return { items: resp.Items || [], lastEvaluatedKey: resp.LastEvaluatedKey || null };
    }
  },
};

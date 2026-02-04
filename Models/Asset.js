const { newObjectId } = require('../utils/objectId');
const { getDynamoClient } = require('../config/db');
require('dotenv').config();
const {
    PutCommand,
    GetCommand,
    DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.DYNAMO_DB_ASSETS || 'FacultyCreditsAssets';

module.exports = {
    /**
     * Create a new asset mapping
     * @param {Object} data - { id (optional), targetUrl, mimeType }
     */
    async create(data) {
        const client = getDynamoClient();
        const id = data.id || newObjectId(); // Allow custom ID (e.g. 'logo-v1') or generate one

        const item = {
            _id: id,
            targetUrl: data.targetUrl,
            mimeType: data.mimeType || 'application/octet-stream',
            createdAt: new Date().toISOString(),
        };

        await client.send(new PutCommand({ TableName: TABLE, Item: item }));
        return item;
    },

    /**
     * Find asset by ID
     */
    async findById(id) {
        const client = getDynamoClient();
        const res = await client.send(
            new GetCommand({ TableName: TABLE, Key: { _id: id } })
        );
        return res.Item || null;
    },

    /**
     * Delete asset
     */
    async delete(id) {
        const client = getDynamoClient();
        await client.send(
            new DeleteCommand({ TableName: TABLE, Key: { _id: id } })
        );
        return { deleted: true };
    },
};

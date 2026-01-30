const { newObjectId } = require('../utils/objectId');
const { getDynamoClient } = require('../config/db');
require('dotenv').config();
const {
    PutCommand,
    GetCommand,
    ScanCommand,
    UpdateCommand,
    DeleteCommand,
    QueryCommand
} = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.DYNAMO_DB_SESSIONS || 'fcs_sessions';

module.exports = {
    /**
     * Create a new session
     */
    async create(data) {
        const client = getDynamoClient();

        const item = {
            _id: newObjectId(),
            userId: data.userId,
            device: data.device || 'Unknown',
            lastIp: data.lastIp || 'unknown',
            userAgent: data.userAgent || '',
            isValid: true,
            expiresAt: data.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days default
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        await client.send(new PutCommand({ TableName: TABLE, Item: item }));
        return item;
    },

    /**
     * Find sessions by user ID
     */
    async findByUserId(userId) {
        const client = getDynamoClient();
        // Using scan since userId might not be the partition key unless we configure a GSI
        // For now, keeping it simple consistent with other models
        const res = await client.send(new ScanCommand({ TableName: TABLE }));
        const items = res.Items || [];

        return items
            .filter((s) => s.userId === userId && s.isValid)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    /**
     * Find session by ID
     */
    async findById(id) {
        const client = getDynamoClient();
        const res = await client.send(
            new GetCommand({ TableName: TABLE, Key: { _id: id } })
        );
        return res.Item || null;
    },

    /**
     * Update session by ID
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
     * Revoke session
     */
    async revoke(id) {
        return this.update(id, { isValid: false, updatedAt: new Date().toISOString() });
    },

    /**
     * Delete session
     */
    async delete(id) {
        const client = getDynamoClient();
        await client.send(
            new DeleteCommand({ TableName: TABLE, Key: { _id: id } })
        );
        return { deleted: true };
    }
};

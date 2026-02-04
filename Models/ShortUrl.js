const { newObjectId } = require('../utils/objectId');
const { getDynamoClient } = require('../config/db');
require('dotenv').config();
const {
    PutCommand,
    GetCommand,
    DeleteCommand,
    UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

const TABLE = process.env.DYNAMO_DB_SHORT_URLS || 'FacultyCreditsShortUrls';

module.exports = {
    /**
     * Create a new short URL
     * @param {Object} data - { id (optional), originalUrl }
     */
    async create(data) {
        const client = getDynamoClient();
        // Use provided custom alias or generate a short ID (simple slice of uuid for now, or nanoid logic if preferred)
        // For simplicity, we use newObjectId() or the one passed.
        // Ideally, a shortener uses shorter IDs (like base62), but for this system, we accept the ID provided by the controller.
        const id = data.id || newObjectId();

        const item = {
            _id: id,
            originalUrl: data.originalUrl,
            visits: 0,
            createdAt: new Date().toISOString(),
        };

        await client.send(new PutCommand({ TableName: TABLE, Item: item }));
        return item;
    },

    /**
     * Find by ID
     */
    async findById(id) {
        const client = getDynamoClient();
        const res = await client.send(
            new GetCommand({ TableName: TABLE, Key: { _id: id } })
        );
        return res.Item || null;
    },

    /**
     * Increment visit count
     */
    async incrementVisits(id) {
        const client = getDynamoClient();
        try {
            await client.send(new UpdateCommand({
                TableName: TABLE,
                Key: { _id: id },
                UpdateExpression: 'SET visits = visits + :inc',
                ExpressionAttributeValues: { ':inc': 1 }
            }));
        } catch (e) {
            // Ignore errors for metric updates to avoid blocking the redirect
            console.error('Failed to increment visit count', e);
        }
    },

    /**
     * Delete
     */
    async delete(id) {
        const client = getDynamoClient();
        await client.send(
            new DeleteCommand({ TableName: TABLE, Key: { _id: id } })
        );
        return { deleted: true };
    },
};

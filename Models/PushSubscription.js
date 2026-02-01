const { getDynamoClient } = require('../config/db');
const { PutCommand, QueryCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
require('dotenv').config();

const TABLE = process.env.DYNAMO_DB_SUBSCRIPTIONS || 'PushSubscriptions';

module.exports = {
    /**
     * Create or Update Subscription
     * @param {Object} subscription - { endpoint, keys: { p256dh, auth }, userId, userAgent }
     */
    async create(data) {
        const client = getDynamoClient();
        // Use endpoint as partition key as it is unique per device/browser
        const item = {
            endpoint: data.endpoint,
            keys: data.keys,
            userId: data.userId,
            userAgent: data.userAgent || 'Unknown',
            createdAt: new Date().toISOString(),
        };

        await client.send(new PutCommand({ TableName: TABLE, Item: item }));
        return item;
    },

    /**
     * Find all subscriptions for a userId
     */
    async findByUserId(userId) {
        const client = getDynamoClient();
        // Ideally use a GSI on userId. If not, we have to scan (inefficient) or structure the table differently.
        // For now, assuming low volume or GSI exists. Let's use Scan with filter for simplicity in this dev phase,
        // BUT strictly, we should assume a GSI named 'UserIdIndex' if we were strictly following DynamoDB patterns.
        // Given the constraints and previous patterns, a Scan filter is safe enough for small scale.

        // Better: If we can't ensure GSI, let's just Scan. A real prod app needs GSI.
        const params = {
            TableName: TABLE,
            FilterExpression: 'userId = :uid',
            ExpressionAttributeValues: { ':uid': userId }
        };

        const res = await client.send(new ScanCommand(params));
        return res.Items || [];
    },

    /**
     * Delete a subscription (e.g., if invalid/expired)
     */
    async delete(endpoint) {
        const client = getDynamoClient();
        await client.send(new DeleteCommand({ TableName: TABLE, Key: { endpoint } }));
        return { deleted: true };
    }
};

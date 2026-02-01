const { CreateTableCommand } = require('@aws-sdk/client-dynamodb');
const { getDynamoClient, connectDB } = require('../config/db');
require('dotenv').config();

const TABLE_NAME = process.env.DYNAMO_DB_SESSIONS || 'FacultyCreditsUsersSessions';

async function createTable() {
    await connectDB();
    const client = getDynamoClient();

    const params = {
        TableName: TABLE_NAME,
        KeySchema: [
            { AttributeName: '_id', KeyType: 'HASH' } // Partition key
        ],
        AttributeDefinitions: [
            { AttributeName: '_id', AttributeType: 'S' }
        ],
        ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5
        }
    };

    try {
        console.log(`Creating table: ${TABLE_NAME}...`);
        const data = await client.send(new CreateTableCommand(params));
        console.log('Table Created Successfully:', data.TableDescription.TableName);
    } catch (err) {
        if (err.name === 'ResourceInUseException') {
            console.log('Table already exists.');
        } else {
            console.error('Error creating table:', err);
        }
    }
}

createTable();

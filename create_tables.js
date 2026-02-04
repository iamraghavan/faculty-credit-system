const { CreateTableCommand, ListTablesCommand } = require('@aws-sdk/client-dynamodb');
const { connectDB, getDynamoClient } = require('./config/db');
require('dotenv').config();

const TABLES = [
    {
        TableName: process.env.DYNAMO_DB_ASSETS || 'FacultyCreditsAssets',
        KeySchema: [{ AttributeName: '_id', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: '_id', AttributeType: 'S' }],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
    },
    {
        TableName: process.env.DYNAMO_DB_SHORT_URLS || 'FacultyCreditsShortUrls',
        KeySchema: [{ AttributeName: '_id', KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: '_id', AttributeType: 'S' }],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
    }
];

async function createTables() {
    await connectDB();
    const client = getDynamoClient(); // This returns the DocumentClient, we need the raw Client for CreateTable? 
    // Actually getDynamoClient returns a ddbDocClient which wraps the raw client.
    // However, ddbDocClient.send(CreateTableCommand) works fine.

    // List existing to skip
    // We need the LOW LEVEL client for ListTables if using v3 specific commands or just use the doc client.
    // Let's just try to create and catch "ResourceInUseException".

    for (const table of TABLES) {
        try {
            console.log(`Creating table: ${table.TableName}...`);
            await client.send(new CreateTableCommand(table));
            console.log(`Table ${table.TableName} created successfully.`);
        } catch (err) {
            if (err.name === 'ResourceInUseException') {
                console.log(`Table ${table.TableName} already exists.`);
            } else {
                console.error(`Error creating ${table.TableName}:`, err);
            }
        }
    }
}

createTables().then(() => {
    console.log('Done.');
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});

/** Provision the application settings and notification tables when absent. */
require('dotenv').config();
const {
  DynamoDBClient,
  DescribeTableCommand,
  CreateTableCommand,
  waitUntilTableExists,
} = require('@aws-sdk/client-dynamodb');

const required = ['DYNAMO_DB_POLICIES', 'DYNAMO_DB_NOTIFICATIONS'];
const apply = process.argv.includes('--apply');

async function run() {
  const region = process.env.AWS_REGION;
  if (!region) throw new Error('AWS_REGION is required');
  const client = new DynamoDBClient({ region });
  for (const setting of required) {
    const TableName = process.env[setting];
    if (!TableName) throw new Error(`${setting} is required`);
    try {
      const { Table } = await client.send(new DescribeTableCommand({ TableName }));
      console.log(`${setting}: ${Table.TableStatus}`);
      continue;
    } catch (error) {
      if (error.name !== 'ResourceNotFoundException') throw error;
    }
    if (!apply) {
      console.log(`${setting}: missing (run with --apply to create)`);
      continue;
    }
    try {
      await client.send(
        new CreateTableCommand({
          TableName,
          AttributeDefinitions: [{ AttributeName: '_id', AttributeType: 'S' }],
          KeySchema: [{ AttributeName: '_id', KeyType: 'HASH' }],
          BillingMode: 'PAY_PER_REQUEST',
        }),
      );
      console.log(`${setting}: created`);
    } catch (error) {
      if (error.name !== 'ResourceInUseException') throw error;
      console.log(`${setting}: created concurrently`);
    }
    await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName });
    console.log(`${setting}: ACTIVE`);
  }
}

run().catch((error) => {
  console.error(`Provisioning failed: ${error.name || error.message}`);
  process.exitCode = 1;
});

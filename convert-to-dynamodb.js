const fs = require('fs');
const path = require('path');

const inputPath = path.join(
  '/media/raghavanjeeva/72D0E3B4D0E37CAB/EGSP Projects/credit-hub/faculty-credit-system',
  'credittitles-dynamo.json'
);

const outputDir = path.join(
  '/media/raghavanjeeva/72D0E3B4D0E37CAB/EGSP Projects/credit-hub/faculty-credit-system',
  'batch-output'
);

const tableName = "CreditTitles"; // Replace with your DynamoDB table name

// Ensure output directory exists
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

// Load the input JSON
const rawData = fs.readFileSync(inputPath, 'utf8');
const data = JSON.parse(rawData);

// Convert each item to DynamoDB PutRequest format
function convertItem(item) {
  const dynamoItem = {};

  for (const [key, value] of Object.entries(item)) {
    if (typeof value === 'string') {
      dynamoItem[key] = { S: value };
    } else if (typeof value === 'number') {
      dynamoItem[key] = { N: value.toString() };
    } else if (typeof value === 'boolean') {
      dynamoItem[key] = { BOOL: value };
    } else if (value === null || value === undefined) {
      continue;
    } else if (Array.isArray(value)) {
      dynamoItem[key] = { L: value.map(v => ({ S: String(v) })) };
    } else if (typeof value === 'object') {
      const nested = {};
      for (const [k, v] of Object.entries(value)) {
        nested[k] = { S: String(v) };
      }
      dynamoItem[key] = { M: nested };
    } else {
      dynamoItem[key] = { S: JSON.stringify(value) };
    }
  }

  return { PutRequest: { Item: dynamoItem } };
}

// Split data into chunks of 20 items
function chunkArray(arr, chunkSize) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }
  return chunks;
}

const convertedItems = data.map(convertItem);
const chunks = chunkArray(convertedItems, 20);

// Write each chunk to a separate JSON file
chunks.forEach((chunk, index) => {
  const filePath = path.join(outputDir, `cl_${index + 1}.json`);
  const dynamoJSON = { [tableName]: chunk };
  fs.writeFileSync(filePath, JSON.stringify(dynamoJSON, null, 2));
  console.log(`✅ Batch ${index + 1} written: ${filePath}`);
});

const fs = require("fs");

// Recursive converter: MongoDB Extended JSON ➜ DynamoDB JSON
function mongoToDynamo(doc) {
  const result = {};
  for (const [key, value] of Object.entries(doc)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      // Handle MongoDB Extended JSON ($oid, $date)
      if (value.$oid) {
        result[key] = { S: value.$oid };
      } else if (value.$date) {
        result[key] = { S: value.$date };
      } else {
        result[key] = { M: mongoToDynamo(value) };
      }
    } else if (Array.isArray(value)) {
      result[key] = {
        L: value.map((v) =>
          typeof v === "object" && v !== null
            ? { M: mongoToDynamo(v) }
            : { S: String(v) }
        ),
      };
    } else if (typeof value === "boolean") {
      result[key] = { BOOL: value };
    } else if (typeof value === "number") {
      result[key] = { N: String(value) };
    } else if (value === null || value === undefined) {
      result[key] = { NULL: true };
    } else {
      result[key] = { S: String(value) };
    }
  }
  return result;
}

const inputFile = "credittitles.json";
const outputFile = "credittitles-dynamo.json";

// Read each line (newline-delimited JSON from mongoexport)
const rawData = fs.readFileSync(inputFile, "utf-8").trim().split("\n");

// Convert each MongoDB document
const dynamoDocs = rawData.map((line) => ({
  PutRequest: { Item: mongoToDynamo(JSON.parse(line)) },
}));

// ✅ Wrap in an object that matches DynamoDB BatchWriteItem structure
const outputJson = {
  credittitles: dynamoDocs,
};

// Write formatted DynamoDB JSON file
fs.writeFileSync(outputFile, JSON.stringify(outputJson, null, 2));

console.log("✅ Converted successfully → credittitles-dynamo.json (DynamoDB import format)");

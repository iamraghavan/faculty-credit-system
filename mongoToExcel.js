const fs = require("fs");
const XLSX = require("xlsx");

// Normalize MongoDB Extended JSON to plain JSON
function normalizeMongo(doc) {
  const result = {};
  for (const [key, value] of Object.entries(doc)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (value.$oid) {
        result[key] = value.$oid; // plain string
      } else if (value.$date) {
        result[key] = value.$date; // ISO string
      } else {
        result[key] = normalizeMongo(value); // recursive
      }
    } else if (Array.isArray(value)) {
      result[key] = value.map((v) =>
        typeof v === "object" && v !== null ? normalizeMongo(v) : v
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

const inputFile = "credittitles.json";
const outputExcelFile = "credittitles.xlsx";

// Read newline-delimited JSON
const rawData = fs.readFileSync(inputFile, "utf-8").trim().split("\n");

// Normalize each MongoDB document
const plainDocs = rawData.map((line) => normalizeMongo(JSON.parse(line)));

// Convert to Excel worksheet
const worksheet = XLSX.utils.json_to_sheet(plainDocs);

// Create a new workbook and append worksheet
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, "CreditTitles");

// Write to Excel file
XLSX.writeFile(workbook, outputExcelFile);

console.log(`✅ Converted ${plainDocs.length} records → ${outputExcelFile}`);

// Downloads Amazon's official DynamoDB Local (≈50 MB) into backend/.dynamodb-local
// Requires Java 17+. Used only for tests; it never talks to AWS.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', '..', '.dynamodb-local');
if (fs.existsSync(path.join(dir, 'DynamoDBLocal.jar'))) { console.log('DynamoDB Local already installed.'); process.exit(0); }
fs.mkdirSync(dir, { recursive: true });
const zip = path.join(dir, 'ddb.zip');
const url = 'https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.zip';
console.log('Downloading', url);
execSync(`curl -sSL -o "${zip}" ${url}`, { stdio: 'inherit' });
execSync(process.platform === 'win32'
  ? `powershell -NoProfile -Command "Expand-Archive -Force '${zip}' '${dir}'"`
  : `unzip -q -o "${zip}" -d "${dir}"`, { stdio: 'inherit' });
fs.unlinkSync(zip);
console.log('Installed to', dir);

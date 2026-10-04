/** Stops DynamoDB Local if this test run started it. */
const path = require('path');
const fs = require('fs');

const PID_FILE = path.join(__dirname, '..', '..', '.dynamodb-local', '.test-pid');

module.exports = async function globalTeardown() {
  if (!fs.existsSync(PID_FILE)) return;
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8'));
  fs.unlinkSync(PID_FILE);
  try { process.kill(pid); } catch { /* already stopped */ }
};

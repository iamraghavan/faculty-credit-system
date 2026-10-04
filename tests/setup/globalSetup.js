/**
 * Starts DynamoDB Local (in-memory, port 8000) before the test run if it is
 * not already running. Nothing is written to disk; data vanishes on stop.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = 8000;
const DIR = path.join(__dirname, '..', '..', '.dynamodb-local');
const PID_FILE = path.join(DIR, '.test-pid');

function ping() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

module.exports = async function globalSetup(globalConfig) {
  // Unit-only runs do not need the database.
  const projects = (globalConfig.selectProjects || []).map(String);
  if (projects.length && !projects.includes('api')) return;

  if (await ping()) return; // already running (e.g. started by `pnpm db:local`)

  const jar = path.join(DIR, 'DynamoDBLocal.jar');
  if (!fs.existsSync(jar)) {
    throw new Error('DynamoDB Local is missing. Run: node scripts/test/install-dynamodb-local.js');
  }
  const child = spawn('java', [
    `-Djava.library.path=${path.join(DIR, 'DynamoDBLocal_lib')}`,
    '-jar', jar, '-inMemory', '-port', String(PORT),
  ], { cwd: DIR, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));

  for (let i = 0; i < 60; i++) {
    if (await ping()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('DynamoDB Local did not start within 30 seconds (is Java installed?)');
};

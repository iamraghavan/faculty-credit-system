/**
 * Starts the REAL backend app on a local port, wired to DynamoDB Local with
 * seeded test data. Used by the smoke test, load test and frontend E2E tests.
 *
 * SAFETY (same rules as the Jest tests):
 *  - fake credentials, database endpoint must be localhost
 *  - email / WhatsApp / GitHub / Firebase / web-push replaced by stubs
 *  - every outgoing network connection except localhost is blocked (nock)
 *
 * Usage:  node tests/support/testServer.js            (port 5050)
 *         TEST_SERVER_PORT=5050 NO_RATE_LIMIT=1 node tests/support/testServer.js
 */
const path = require('path');
const http = require('http');
const ROOT = path.join(__dirname, '..', '..');

// 1. Environment (reuses the Jest test settings, but a fixed table prefix).
require('../setup/testEnv');
const prefix = process.env.TEST_SERVER_PREFIX || 'fcs_srv';
for (const k of Object.keys(process.env)) {
  if (k.startsWith('DYNAMO_DB_')) process.env[k] = process.env[k].replace(process.env.TEST_TABLE_PREFIX, prefix);
}
process.env.TEST_TABLE_PREFIX = prefix;
process.env.NODE_ENV = process.env.TEST_SERVER_NODE_ENV || 'test';
process.env.CORS_ORIGIN = process.env.TEST_CORS_ORIGIN || 'http://localhost:9002';

// 2. Block the outside world.
const nock = require('nock');
nock.disableNetConnect();
nock.enableNetConnect((host) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host));

// 3. Stub outgoing services by pre-filling Node's module cache.
function stub(request, exportsObj) {
  const file = require.resolve(request, { paths: [ROOT] });
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsObj };
}
const sent = { email: [], whatsapp: [] };
const noop = async () => ({ success: true });
stub('dotenv', { config: () => ({ parsed: {} }) });
stub('./utils/email', { sendEmail: async (m) => { sent.email.push(m); return { sent: true }; }, createTransporter: () => ({}) });
stub('./utils/whatsapp', { sendWhatsAppMessage: async (m) => { sent.whatsapp.push(m); return { success: true }; } });
stub('./utils/firebase', { sendFcmNotification: noop });
const fakeUrl = (p) => `https://cdn.jsdelivr.net/gh/test-owner/test-repo@main/${p}`;
stub('./utils/githubUpload', {
  uploadFileToGitHub: async (_l, d) => fakeUrl(d), uploadFileToGitHubBuffer: async (_b, d) => fakeUrl(d), jsDelivrUrl: (o, r, b, p) => fakeUrl(p),
});
stub('web-push', { setVapidDetails() {}, sendNotification: noop, generateVAPIDKeys: () => ({}) });
if (process.env.NO_RATE_LIMIT) stub('./Middleware/rateLimitMiddleware', (req, res, next) => next());

async function start() {
  await require('../setup/globalSetup')({}); // starts DynamoDB Local if needed
  const db = require('../helpers/db');
  await db.resetTables();
  await db.seed();
  const { connectDB } = require(path.join(ROOT, 'config/db'));
  await connectDB();
  const app = require(path.join(ROOT, 'server'));
  // Test-only helper: lets E2E/smoke read the last email (e.g. MFA code). Never in the real app.
  const port = Number(process.env.TEST_SERVER_PORT || 5050);
  const server = http.createServer((req, res) => {
    if (req.url === '/__test__/emails') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(sent.email.slice(-20)));
    }
    if (req.url === '/__test__/reset' && req.method === 'POST') {
      return db.resetTables().then(db.seed).then(() => res.end('ok'));
    }
    return app(req, res);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  console.log(`[test-server] listening on http://127.0.0.1:${port} (tables ${prefix}_*, DynamoDB Local)`);
  const stop = async () => { server.close(); await db.deleteTables(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return server;
}

if (require.main === module) {
  start().catch((e) => { console.error('[test-server] failed:', e); process.exit(1); });
}
module.exports = { start };

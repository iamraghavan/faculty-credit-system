/**
 * Test environment (runs before every test file).
 *
 * SAFETY: every value here is fake. The real .env is never used by tests
 * (dotenv is mocked in afterEnv.js, and dotenv never overwrites a value that
 * is already set). The guard at the bottom aborts the run if the database
 * endpoint is not this computer.
 */
const crypto = require('crypto');

// Unique table prefix per test file so parallel files never share data.
const prefix = `fcs_t_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;

const env = {
  NODE_ENV: 'test',
  PORT: '0',
  CORS_ORIGIN: 'http://localhost:9002',
  FRONTEND_URL: 'http://localhost:9002',
  APP_URL: 'http://localhost:5000',
  PUBLIC_APP_URL: 'http://localhost:9002',
  LOGIN_URL: 'http://localhost:9002/u/portal/auth',

  // Database: DynamoDB Local only, with fake credentials.
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  AWS_SESSION_TOKEN: '',
  AWS_PROFILE: '',
  AWS_ENDPOINT_URL_DYNAMODB: process.env.TEST_DYNAMO_ENDPOINT || 'http://127.0.0.1:8000',
  DYNAMO_DB_USERS: `${prefix}_users`,
  DYNAMO_DB_CREDITS: `${prefix}_credits`,
  DYNAMO_DB_TITLES: `${prefix}_titles`,
  DYNAMO_DB_SESSIONS: `${prefix}_sessions`,
  DYNAMO_DB_POLICIES: `${prefix}_policies`,
  DYNAMO_DB_NOTIFICATIONS: `${prefix}_notifications`,
  DYNAMO_DB_ASSETS: `${prefix}_assets`,
  DYNAMO_DB_SHORT_URLS: `${prefix}_shorturls`,
  DYNAMO_DB_SUBSCRIPTIONS: `${prefix}_pushsubs`,
  DYNAMO_DB_TABLE: `${prefix}_unused`,

  // Auth (test-only values).
  JWT_SECRET: 'test-only-jwt-secret-0123456789abcdef0123456789abcdef',
  JWT_EXPIRES_IN: '1h',
  REQUIRE_SESSION_VALIDATION: 'false',
  SESSION_TIMEOUT: '3600000',
  MAX_ACTIVE_SESSIONS: '5',
  EXPORT_SIGNING_SECRET: 'test-only-export-signing-secret-0123456789abcdef',

  // External services: fake/empty. All of them are also mocked and the
  // network is blocked, so nothing can leave this computer.
  EMAIL_HOST: '127.0.0.1', EMAIL_PORT: '2525', EMAIL_USER: 'test@example.org', EMAIL_PASS: 'not-a-real-password',
  EMAIL_SECURE: 'false', EMAIL_DEBUG: 'false',
  ASSET_GH_OWNER: 'test-owner', ASSET_GH_REPO: 'test-repo', ASSET_GH_BRANCH: 'main', GITHUB_TOKEN: 'test-token-not-real',
  FIREBASE_SERVICE_ACCOUNT: '', GCP_API_KEY: '',
  WHATSAPP_API_URL: 'http://127.0.0.1:1/whatsapp', WHATSAPP_TOKEN: '', WHATSAPP_TEST_PHONE: '',
  ENFORCE_WHATSAPP_VERIFICATION: 'false',
  VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_MAILTO: 'mailto:test@example.org',
  BLOCK_DATACENTER: 'false',
  ENABLE_SELF_PINGER: 'false', SELF_PINGER_HOST: '', SELF_PINGER_ENDPOINTS: '',
};
Object.assign(process.env, env);
process.env.TEST_TABLE_PREFIX = prefix;

// ---- Guard: refuse to run against anything but a local database ----
const endpoint = new URL(process.env.AWS_ENDPOINT_URL_DYNAMODB);
if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname)) {
  throw new Error(`SAFETY STOP: tests must use a local DynamoDB, got ${endpoint.hostname}`);
}
if (/^(AKIA|ASIA)/.test(process.env.AWS_ACCESS_KEY_ID)) {
  throw new Error('SAFETY STOP: a real-looking AWS access key is configured for tests');
}

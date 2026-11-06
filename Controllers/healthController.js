// controllers/healthController.js
// Health checks for uptime monitors (roadmap Q-7, SEC-23/B-30).
// They return only a status - never hostnames, IPs, versions or memory.
const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { getDynamoClient } = require('../config/db');

const READY_TIMEOUT_MS = 2000;

/** GET /health/live - the process is up (no dependencies touched). */
exports.live = (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ status: 'ok' });
};

/** GET /health/ready (and /api/health) - the database answers within 2 seconds. */
exports.ready = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const client = getDynamoClient();
    for (const TableName of [
      process.env.DYNAMO_DB_USERS,
      process.env.DYNAMO_DB_POLICIES,
      process.env.DYNAMO_DB_NOTIFICATIONS,
    ]) {
      await client.send(new GetCommand({ TableName, Key: { _id: '__health_check__' } }), {
        abortSignal: AbortSignal.timeout(READY_TIMEOUT_MS),
      });
    }
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Readiness check failed:', error.name || error.message);
    res.status(503).json({ status: 'unavailable' });
  }
};

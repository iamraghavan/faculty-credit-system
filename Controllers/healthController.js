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
    for (const [alias, TableName] of Object.entries({
      users: process.env.DYNAMO_DB_USERS,
      policies: process.env.DYNAMO_DB_POLICIES,
      notifications: process.env.DYNAMO_DB_NOTIFICATIONS,
    })) {
      if (!TableName) {
        console.error('Readiness check: missing table configuration for', alias);
        return res.status(503).json({ status: 'unavailable' });
      }
      try {
        await client.send(new GetCommand({ TableName, Key: { _id: '__health_check__' } }), {
          abortSignal: AbortSignal.timeout(READY_TIMEOUT_MS),
        });
      } catch (error) {
        console.error('Readiness check failed for', alias, error.name || error.message);
        return res.status(503).json({ status: 'unavailable' });
      }
    }
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Readiness check failed:', error.name || error.message);
    res.status(503).json({ status: 'unavailable' });
  }
};

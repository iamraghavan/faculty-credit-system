/**
 * Loads the real Express app connected to DynamoDB Local and provides
 * helpers to obtain login tokens for seeded users.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('./db');

let app;
async function setupApp({ seed = true } = {}) {
  await db.createTables();
  if (seed) await db.seed();
  const { connectDB } = require('../../config/db');
  await connectDB();
  app = require('../../server');
  return app;
}
async function teardownApp() {
  await db.deleteTables();
}

/** Real login through the API (exercises the full login path). */
async function login(email, password = db.PASSWORD) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (!res.body?.data?.token) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.token;
}

/** Fast token: creates a real session row and signs a JWT the same way the app does. */
async function tokenFor(userId, role, { expiresIn = '1h', sessionId, withSession = true } = {}) {
  let sid = sessionId;
  if (withSession && !sid) {
    const Session = require('../../Models/Session');
    const s = await Session.create({
      userId, device: 'jest', lastIp: '127.0.0.1', userAgent: 'jest',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    sid = s._id;
  }
  const payload = withSession ? { id: userId, role, sessionId: sid } : { id: userId, role };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
}

const ROLE_USERS = {
  superadmin: [db.ID.superadmin, 'superadmin'],
  admin: [db.ID.admin, 'admin'],
  oa: [db.ID.oa1, 'oa'],
  oa2: [db.ID.oa2, 'oa'],
  faculty: [db.ID.faculty1, 'faculty'],
  faculty2: [db.ID.faculty2, 'faculty'],
};
async function tokens() {
  const out = {};
  for (const [k, [id, role]] of Object.entries(ROLE_USERS)) out[k] = await tokenFor(id, role);
  return out;
}

const api = () => request(app);
const auth = (t) => ({ Authorization: `Bearer ${t}` });

module.exports = { setupApp, teardownApp, login, tokenFor, tokens, api, auth, getApp: () => app };

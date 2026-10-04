/**
 * Test database helpers: create/delete the per-file tables in DynamoDB Local
 * and seed known users, credit titles and credits.
 */
const bcrypt = require('bcryptjs');
const {
  DynamoDBClient, CreateTableCommand, DeleteTableCommand, waitUntilTableExists,
} = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const raw = new DynamoDBClient({ region: process.env.AWS_REGION });
const doc = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });

const TABLE_VARS = [
  'DYNAMO_DB_USERS', 'DYNAMO_DB_CREDITS', 'DYNAMO_DB_TITLES', 'DYNAMO_DB_SESSIONS', 'DYNAMO_DB_POLICIES',
  'DYNAMO_DB_NOTIFICATIONS', 'DYNAMO_DB_ASSETS', 'DYNAMO_DB_SHORT_URLS', 'DYNAMO_DB_SUBSCRIPTIONS',
];
const keyFor = (envVar) => (envVar === 'DYNAMO_DB_SUBSCRIPTIONS' ? 'endpoint' : '_id');
const T = {
  users: () => process.env.DYNAMO_DB_USERS,
  credits: () => process.env.DYNAMO_DB_CREDITS,
  titles: () => process.env.DYNAMO_DB_TITLES,
  sessions: () => process.env.DYNAMO_DB_SESSIONS,
  policies: () => process.env.DYNAMO_DB_POLICIES,
  notifications: () => process.env.DYNAMO_DB_NOTIFICATIONS,
  assets: () => process.env.DYNAMO_DB_ASSETS,
  shortUrls: () => process.env.DYNAMO_DB_SHORT_URLS,
  pushSubs: () => process.env.DYNAMO_DB_SUBSCRIPTIONS,
};

async function createTables() {
  await Promise.all(TABLE_VARS.map(async (v) => {
    const TableName = process.env[v];
    const key = keyFor(v);
    await raw.send(new CreateTableCommand({
      TableName,
      AttributeDefinitions: [{ AttributeName: key, AttributeType: 'S' }],
      KeySchema: [{ AttributeName: key, KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST',
    }));
    await waitUntilTableExists({ client: raw, maxWaitTime: 30 }, { TableName });
  }));
}

async function deleteTables() {
  await Promise.all(TABLE_VARS.map((v) =>
    raw.send(new DeleteTableCommand({ TableName: process.env[v] })).catch(() => {})));
}

async function resetTables() {
  await deleteTables();
  await createTables();
}

const put = (table, Item) => doc.send(new PutCommand({ TableName: T[table](), Item }));
const get = async (table, id, key = '_id') =>
  (await doc.send(new GetCommand({ TableName: T[table](), Key: { [key]: id } }))).Item || null;
const scan = async (table) => (await doc.send(new ScanCommand({ TableName: T[table]() }))).Items || [];

// Passwords used only inside the local test database.
const PASSWORD = 'Test-Passw0rd-123!';
const HASH = bcrypt.hashSync(PASSWORD, 4); // low cost = fast tests; bcrypt.compare still works

// 24-hex-char IDs, the same shape the app generates.
const ID = {
  superadmin: '5a0000000000000000000001',
  admin: '5a0000000000000000000002',
  oa1: '5a0000000000000000000003',
  oa2: '5a0000000000000000000004',
  faculty1: '5a0000000000000000000005',
  faculty2: '5a0000000000000000000006',
  inactive: '5a0000000000000000000007',
  mfaApp: '5a0000000000000000000008',
  mfaEmail: '5a0000000000000000000009',
};
const TITLE = {
  posPaper: '6b0000000000000000000001',
  posWorkshop: '6b0000000000000000000002',
  negLate: '6b0000000000000000000003',
  negAbsent: '6b0000000000000000000004',
  inactiveNeg: '6b0000000000000000000005',
};
// TOTP secret for the mfa-app user (base32, test only).
const MFA_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

function user(id, role, email, extra = {}) {
  const now = new Date().toISOString();
  return {
    _id: id, name: `${role} ${email.split('@')[0]}`, email, password: HASH, role,
    college: 'EGS Pillay Engineering College', department: 'CSE', facultyID: `EGSP/EC/${id.slice(-5)}`,
    apiKey: `ak_test_${id}`, isActive: true, prefix: 'Dr.', whatsappVerified: true, whatsappNumber: '9000000000',
    mfaEnabled: false, mfaAppEnabled: false, mfaEmailEnabled: false, mfaSecret: null,
    currentCredit: 0, creditsByYear: {}, createdAt: now, updatedAt: now, ...extra,
  };
}

const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

function credit(id, faculty, type, points, status, extra = {}) {
  return {
    _id: id, faculty, type, points, status, title: `${type} credit ${id.slice(-3)}`,
    academicYear: '2025-2026', issuedBy: type === 'positive' ? faculty : ID.oa1,
    facultySnapshot: { name: 'snapshot', facultyID: 'EGSP/EC/00000', college: 'EGSPEC', department: 'CSE' },
    createdAt: daysAgo(1), updatedAt: daysAgo(1), ...extra,
  };
}

// Credits with known IDs covering each scoring branch.
const CREDIT = {
  f1PosApproved: '7c0000000000000000000001',
  f1PosPending: '7c0000000000000000000002',
  f1PosRejected: '7c0000000000000000000003',
  f1NegPending: '7c0000000000000000000004',
  f1NegAppealed: '7c0000000000000000000005',
  f1NegOld: '7c0000000000000000000006',
  f2PosPending: '7c0000000000000000000007',
  f2NegByOa2: '7c0000000000000000000008',
  f1NegAppealRejected: '7c0000000000000000000009',
  f1PosVoided: '7c000000000000000000000a',
};

async function seed() {
  const users = [
    user(ID.superadmin, 'superadmin', 'superadmin@example.org'),
    user(ID.admin, 'admin', 'admin@example.org'),
    user(ID.oa1, 'oa', 'oa1@example.org'),
    user(ID.oa2, 'oa', 'oa2@example.org'),
    user(ID.faculty1, 'faculty', 'faculty1@example.org'),
    user(ID.faculty2, 'faculty', 'faculty2@example.org'),
    user(ID.inactive, 'faculty', 'inactive@example.org', { isActive: false }),
    user(ID.mfaApp, 'faculty', 'mfa-app@example.org', { mfaEnabled: true, mfaAppEnabled: true, mfaSecret: MFA_SECRET }),
    user(ID.mfaEmail, 'faculty', 'mfa-email@example.org', { mfaEnabled: true, mfaEmailEnabled: true }),
  ];
  const now = new Date().toISOString();
  const titles = [
    { _id: TITLE.posPaper, title: 'Research paper published', points: 10, type: 'positive', isActive: true, createdAt: now, updatedAt: now },
    { _id: TITLE.posWorkshop, title: 'Workshop conducted', points: 5, type: 'positive', isActive: true, createdAt: now, updatedAt: now },
    { _id: TITLE.negLate, title: 'Late submission of marks', points: 3, type: 'negative', isActive: true, createdAt: now, updatedAt: now },
    { _id: TITLE.negAbsent, title: 'Unauthorised absence', points: 5, type: 'negative', isActive: true, createdAt: now, updatedAt: now },
    { _id: TITLE.inactiveNeg, title: 'Retired category', points: 2, type: 'negative', isActive: false, createdAt: now, updatedAt: now },
  ];
  const credits = [
    credit(CREDIT.f1PosApproved, ID.faculty1, 'positive', 10, 'approved'),
    credit(CREDIT.f1PosPending, ID.faculty1, 'positive', 5, 'pending'),
    credit(CREDIT.f1PosRejected, ID.faculty1, 'positive', 7, 'rejected'),
    credit(CREDIT.f1NegPending, ID.faculty1, 'negative', -3, 'pending', { creditTitle: TITLE.negLate }),
    credit(CREDIT.f1NegAppealed, ID.faculty1, 'negative', -5, 'appealed', {
      creditTitle: TITLE.negAbsent, appealCount: 1,
      appeal: { by: ID.faculty1, reason: 'I was on approved leave', status: 'pending', createdAt: daysAgo(1) },
    }),
    credit(CREDIT.f1NegOld, ID.faculty1, 'negative', -3, 'pending', { createdAt: daysAgo(20), updatedAt: daysAgo(20) }),
    credit(CREDIT.f2PosPending, ID.faculty2, 'positive', 4, 'pending'),
    credit(CREDIT.f2NegByOa2, ID.faculty2, 'negative', -3, 'pending', { issuedBy: ID.oa2, creditTitle: TITLE.negLate }),
    credit(CREDIT.f1NegAppealRejected, ID.faculty1, 'negative', -2, 'approved', {
      appealCount: 1, appeal: { by: ID.faculty1, reason: 'x', status: 'rejected', createdAt: daysAgo(2) },
    }),
    credit(CREDIT.f1PosVoided, ID.faculty1, 'positive', 50, 'deleted'),
  ];
  await Promise.all([
    ...users.map((u) => put('users', u)),
    ...titles.map((t) => put('titles', t)),
    ...credits.map((c) => put('credits', c)),
  ]);
}

module.exports = {
  createTables, deleteTables, resetTables, seed, put, get, scan, doc, raw,
  ID, TITLE, CREDIT, PASSWORD, HASH, MFA_SECRET, credit, user, daysAgo,
};

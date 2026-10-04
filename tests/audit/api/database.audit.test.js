/**
 * Audit: database behaviour - soft deletes, constraints, partial failures.
 */
const crypto = require('crypto');
const { setupApp, teardownApp, tokens, api, auth } = require('../../helpers/app');
const db = require('../../helpers/db');
const { processCredits } = require('../../../utils/calculateCredits');

const { ID } = db;
let T;
beforeAll(async () => { await setupApp(); T = await tokens(); });
afterAll(() => teardownApp());

const newId = () => crypto.randomBytes(12).toString('hex');

describe('records are never physically deleted', () => {
  test('Credit.delete and User.delete refuse', async () => {
    await expect(require('../../../Models/Credit').delete('x')).rejects.toThrow(/disabled/);
    await expect(require('../../../Models/User').delete('x')).rejects.toThrow(/disabled/);
  });

  test('deactivating a user keeps the record and blocks login', async () => {
    const id = newId();
    await db.put('users', db.user(id, 'faculty', `del-${id}@example.org`));
    expect((await api().delete(`/api/v1/users/${id}`).set(auth(T.admin))).status).toBe(200);
    const u = await db.get('users', id);
    expect(u).toMatchObject({ isActive: false, deactivatedBy: ID.admin });
    expect((await api().post('/api/v1/auth/login').send({ email: `del-${id}@example.org`, password: db.PASSWORD })).status).toBe(403);
  });

  test('credit titles are soft-deleted (isActive=false) and hidden from the admin list', async () => {
    const created = await api().post('/api/v1/admin/credit-title').set(auth(T.admin)).send({ title: 'Temp title', points: 2, type: 'positive' });
    const id = created.body.data._id;
    await api().delete(`/api/v1/admin/credit-title/${id}`).set(auth(T.admin));
    expect((await db.get('titles', id)).isActive).toBe(false);
    const list = await api().get('/api/v1/admin/credit-title').set(auth(T.admin));
    expect(list.body.items.find((t) => t._id === id)).toBeUndefined();
  });

  test.failing('[BUG] the /credits/credit-title list still shows deactivated titles', async () => {
    const list = await api().get('/api/v1/credits/credit-title').set(auth(T.faculty));
    expect(list.body.items.some((t) => t.isActive === false)).toBe(false);
  });

  test('sessions get a TTL so the database can expire them', async () => {
    const Session = require('../../../Models/Session');
    const s = await Session.create({ userId: ID.faculty1 });
    expect(typeof (await db.get('sessions', s._id)).ttl).toBe('number');
  });
});

describe('uniqueness and consistency (DynamoDB has no unique constraints)', () => {
  test.failing('[BUG] two simultaneous registrations with the same email both succeed (duplicate accounts)', async () => {
    const body = { name: 'Twin', email: 'twin@example.org', password: 'x'.repeat(12), college: 'Engineering', department: 'CSE' };
    const res = await Promise.all([1, 2, 3].map(() => api().post('/api/v1/auth/register').set(auth(T.admin)).send(body)));
    const users = (await db.scan('users')).filter((u) => u.email === 'twin@example.org');
    expect(res.filter((r) => r.status === 201).length).toBe(1);
    expect(users.length).toBe(1);
  });

  test('sequential duplicate email is refused', async () => {
    const body = { name: 'Solo', email: 'solo@example.org', password: 'x'.repeat(12), college: 'Engineering', department: 'CSE' };
    expect((await api().post('/api/v1/auth/register').set(auth(T.admin)).send(body)).status).toBe(201);
    expect((await api().post('/api/v1/auth/register').set(auth(T.admin)).send(body)).status).toBe(400);
  });

  test.failing('[BUG] if recalculation fails after an approval, the API still says success and the stored total is wrong', async () => {
    const User = require('../../../Models/User');
    const credit = newId();
    await db.put('credits', db.credit(credit, ID.faculty2, 'positive', 9, 'pending'));
    const spy = jest.spyOn(User, 'update').mockRejectedValueOnce(new Error('throttled'));
    const res = await api().put(`/api/v1/admin/credits/positive/${credit}/status`).set(auth(T.admin)).send({ status: 'approved' });
    spy.mockRestore();
    const credits = (await db.scan('credits')).filter((c) => c.faculty === ID.faculty2);
    const stored = (await db.get('users', ID.faculty2)).currentCredit;
    const tellsTruth = res.body.balanceUpdated === false;
    expect(tellsTruth || stored === processCredits(credits).runningTotal).toBe(true);
  });

  test('the recalc endpoint repairs a drifted total', async () => {
    await db.put('users', { ...(await db.get('users', ID.faculty2)), currentCredit: 12345 });
    await api().post(`/api/v1/credits/credits/${ID.faculty2}/recalc-credits`).set(auth(T.admin));
    const credits = (await db.scan('credits')).filter((c) => c.faculty === ID.faculty2);
    expect((await db.get('users', ID.faculty2)).currentCredit).toBe(processCredits(credits).runningTotal);
  });

  test('credit snapshot keeps the faculty name at issue time even if the user is renamed', async () => {
    const res = await api().post('/api/v1/admin/credits/negative').set(auth(T.admin))
      .send({ facultyId: ID.faculty2, creditTitleId: db.TITLE.negLate, academicYear: '2025-2026' });
    const before = res.body.data.facultySnapshot.name;
    await db.put('users', { ...(await db.get('users', ID.faculty2)), name: 'Renamed' });
    expect((await db.get('credits', res.body.data._id)).facultySnapshot.name).toBe(before);
  });
});

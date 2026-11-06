/**
 * Audit: authorization matrix. Every protected endpoint x every role.
 * "allowed" means the request passes the access check (any status except
 * 401/403). "denied" means 403 (or 401 for anonymous).
 */
const { setupApp, teardownApp, tokens, api, auth } = require('../../helpers/app');
const db = require('../../helpers/db');

const { ID, TITLE, CREDIT } = db;
const ROLES = ['anonymous', 'faculty', 'oa', 'admin', 'superadmin'];
let T;

beforeAll(async () => {
  await setupApp();
  T = await tokens();
});
afterAll(() => teardownApp());

const ALL = ['faculty', 'oa', 'admin', 'superadmin'];
const ADM = ['admin', 'superadmin'];
const STAFF = ['oa', 'admin', 'superadmin'];

// [method, path, rolesAllowed, body?]. Paths use faculty1 as "self".
const MATRIX = [
  // auth
  ['post', '/api/v1/auth/register', ADM, {}],
  ['post', '/api/v1/auth/users/bulk-upload', ADM, {}],
  ['get', '/api/v1/auth/profile', ALL],
  ['get', '/api/v1/auth/sessions', ALL],
  ['get', '/api/v1/auth/refresh', ALL],
  // users
  ['get', '/api/v1/users/me', ALL],
  ['get', '/api/v1/users/me/professional-profile', ALL],
  ['get', '/api/v1/users', STAFF],
  ['post', '/api/v1/users', ADM, 'form'],
  ['get', `/api/v1/users/${ID.faculty2}`, STAFF],
  ['put', `/api/v1/users/${ID.faculty2}`, ADM, 'form'],
  ['post', `/api/v1/users/${ID.faculty2}/reset-password`, ADM, {}],
  ['delete', `/api/v1/users/${ID.faculty2}`, [], {}], // tested separately (destructive)
  ['get', `/api/v1/users/${ID.faculty2}/professional-profile`, ADM],
  ['put', `/api/v1/users/${ID.faculty2}/employment`, ADM, {}],
  // credits
  ['post', '/api/v1/credits/credits/positive', ['faculty'], {}],
  ['get', `/api/v1/credits/credits/faculty/${ID.faculty2}`, ADM],
  ['get', `/api/v1/credits/${ID.faculty2}/credits`, ADM],
  ['get', `/api/v1/credits/credits/faculty/${ID.faculty2}/negative`, ADM],
  ['post', '/api/v1/credits/credit-title', ADM, {}],
  ['get', '/api/v1/credits/credit-title', ALL],
  ['post', '/api/v1/credits/credits/negative', STAFF, {}],
  ['put', `/api/v1/credits/credits/negative/${CREDIT.f2NegByOa2}`, ADM, {}],
  ['post', `/api/v1/credits/credits/${ID.faculty2}/recalc-credits`, STAFF, {}],
  // admin
  ['post', '/api/v1/admin/credit-title', ADM, {}],
  ['put', `/api/v1/admin/credit-title/${TITLE.posWorkshop}`, ADM, {}],
  ['get', '/api/v1/admin/credits/positive', ADM],
  ['put', `/api/v1/admin/credits/positive/${CREDIT.f2PosPending}/status`, ADM, { status: 'nope' }],
  ['post', '/api/v1/admin/credits/positive', STAFF, {}],
  ['post', '/api/v1/admin/credits/negative', STAFF, {}],
  ['get', '/api/v1/admin/credits/negative', ADM],
  ['get', '/api/v1/admin/credits/negative/appeals', ADM],
  ['get', '/api/v1/admin/credits/negative/appeals/all', ADM],
  ['put', `/api/v1/admin/credits/negative/${CREDIT.f2NegByOa2}/appeal`, ADM, { status: 'nope' }],
  ['get', `/api/v1/admin/faculty/${ID.faculty2}/credits/negative`, ['admin']],
  ['get', '/api/v1/admin/oa/credits/issued', ['oa']],
  ['get', `/api/v1/admin/faculty/${ID.faculty2}/credit-ledger`, ADM],
  ['get', '/api/v1/admin/faculty-ledger/ranking', ADM],
  // analytics, reports, exports, policies, notifications
  ['get', '/api/v1/analytics/users', ADM],
  ['get', '/api/v1/analytics/credits', ADM],
  ['get', '/api/v1/analytics/credit-titles', ADM],
  ['get', '/api/v1/analytics/academic-years', ADM],
  ['get', '/api/v1/analytics/credit-trends', ADM],
  ['get', '/api/v1/reports', ADM],
  ['post', '/api/v1/exports/official-excel', ADM, {}],
  ['get', '/api/v1/policies', STAFF],
  ['post', '/api/v1/policies', ADM, {}],
  ['post', '/api/v1/notifications/remark', STAFF, {}],
  ['post', '/api/v1/notifications/broadcast', ADM, {}],
  ['get', '/api/v1/notifications', ALL],
  ['get', '/api/v1/search?q=zzzz-no-match', ALL],
].filter(([, , allowed]) => allowed.length > 0);

const cases = [];
for (const [method, path, allowed, body] of MATRIX) {
  for (const role of ROLES) cases.push([role, method.toUpperCase(), path, allowed.includes(role), body]);
}

test.each(cases)('%s %s %s -> allowed=%s', async (role, method, path, allowed, body) => {
  let req = api()[method.toLowerCase()](path);
  if (role !== 'anonymous') req = req.set(auth(T[role]));
  if (body === 'form') req = req.field('noop', '1');
  else if (body) req = req.send(body);
  const res = await req;
  if (role === 'anonymous') {
    expect(res.status).toBe(401);
  } else if (allowed) {
    expect([401, 403]).not.toContain(res.status);
  } else {
    expect(res.status).toBe(403);
  }
});

describe('specific escalation attempts', () => {
  test.failing(
    '[BUG] JSON body to POST/PUT /users never gets a response (request hangs until timeout)',
    async () => {
      const res = await api()
        .put(`/api/v1/users/${ID.faculty2}`)
        .set(auth(T.admin))
        .send({ name: 'x' })
        .timeout(5000)
        .catch((e) => ({ status: e.timeout ? 'timeout' : e.status }));
      expect(res.status).not.toBe('timeout');
    },
    15000,
  );

  test.failing(
    '[BUG] superadmin is refused on /admin/faculty/:id/credits/negative (controller checks role names)',
    async () => {
      expect(
        (await api().get(`/api/v1/admin/faculty/${ID.faculty2}/credits/negative`).set(auth(T.superadmin))).status,
      ).toBe(200);
    },
  );

  test('[DESIGN] any admin can create another ADMIN through /auth/register (no superadmin approval)', async () => {
    // Documented: any admin can mint more admins; no superadmin approval. Business decision.
    const res = await api()
      .post('/api/v1/auth/register')
      .set(auth(T.admin))
      .send({
        name: 'Second Admin',
        email: 'admin2@example.org',
        password: 'x'.repeat(12),
        college: 'EGS Pillay Engineering College',
        role: 'admin',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('admin');
  });

  test('admin cannot promote anyone to superadmin', async () => {
    const res = await api().put(`/api/v1/users/${ID.faculty2}`).set(auth(T.admin)).field('role', 'superadmin');
    expect(res.status).toBe(400);
  });

  test('admin cannot edit or deactivate the superadmin', async () => {
    expect((await api().put(`/api/v1/users/${ID.superadmin}`).set(auth(T.admin)).field('name', 'pwned')).status).toBe(
      403,
    );
    expect((await api().delete(`/api/v1/users/${ID.superadmin}`).set(auth(T.admin))).status).toBe(403);
  });

  test('admin cannot deactivate or demote themselves', async () => {
    expect((await api().put(`/api/v1/users/${ID.admin}`).set(auth(T.admin)).field('role', 'faculty')).status).toBe(409);
    expect((await api().delete(`/api/v1/users/${ID.admin}`).set(auth(T.admin))).status).toBe(409);
  });

  test('faculty profile update cannot change role, isActive or credits (mass assignment)', async () => {
    const res = await api()
      .put('/api/v1/users/me')
      .set(auth(T.faculty))
      .field('name', 'Faculty One')
      .field('role', 'admin')
      .field('isActive', 'false')
      .field('currentCredit', '9999')
      .field('permissionOverrides', 'credit.review');
    expect(res.status).toBe(200);
    const u = await db.get('users', ID.faculty1);
    expect(u).toMatchObject({ role: 'faculty', isActive: true });
    expect(u.currentCredit).not.toBe('9999');
    expect(u.permissionOverrides).toBeUndefined();
  });

  test('[FIXED] faculty cannot change their own department via /users/me', async () => {
    await api().put('/api/v1/users/me').set(auth(T.faculty2)).field('department', 'MBA');
    expect((await db.get('users', ID.faculty2)).department).toBe('CSE');
  });

  test('faculty cannot change their email or employment fields through the self profile endpoint', async () => {
    const res = await api().put('/api/v1/users/me').set(auth(T.faculty2)).field('email', 'someone-else@example.org');
    const changed = (await db.get('users', ID.faculty2)).email === 'someone-else@example.org';
    if (changed) await db.put('users', { ...(await db.get('users', ID.faculty2)), email: 'faculty2@example.org' });
    expect(res.status === 200 && changed).toBe(false);
    await api()
      .put('/api/v1/users/me')
      .set(auth(T.faculty2))
      .field('designation', 'Professor')
      .field('roleCategory', 'Senior');
    expect((await db.get('users', ID.faculty2)).designation).not.toBe('Professor');
    expect((await db.get('users', ID.faculty2)).roleCategory).not.toBe('Senior');
  });

  test('OA user directory exposes only faculty, with limited fields', async () => {
    const res = await api().get('/api/v1/users').set(auth(T.oa));
    expect(res.status).toBe(200);
    expect(res.body.items.every((u) => u.role === 'faculty')).toBe(true);
    expect(res.body.items[0]).not.toHaveProperty('currentCredit');
  });

  test('user lists never include password hashes or secrets', async () => {
    const res = await api().get('/api/v1/users').set(auth(T.admin));
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/\$2[aby]\$/);
    expect(text).not.toMatch(/mfaSecret|apiKey|resetPasswordToken/);
  });

  test('changing a WhatsApp number clears verification and profile updates hide secrets', async () => {
    const before = await db.get('users', ID.faculty2);
    await db.put('users', {
      ...before,
      whatsappNumber: '9876543210',
      whatsappVerified: true,
      whatsappOtp: '123456',
      whatsappOtpExpires: Date.now() + 60000,
    });
    try {
      const res = await api().put('/api/v1/users/me').set(auth(T.faculty2)).field('whatsappNumber', '9876543211');
      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('whatsappOtp');
      expect(res.body.data).not.toHaveProperty('apiKey');
      const after = await db.get('users', ID.faculty2);
      expect(after.whatsappVerified).toBe(false);
      expect(after.whatsappOtp).toBeNull();
    } finally {
      await db.put('users', before);
    }
  });

  test('OA global search returns only credits they issued', async () => {
    const res = await api().get('/api/v1/search?q=credit').set(auth(T.oa));
    const neg = res.body.results.find((r) => r.category === 'Negative Credits');
    const pos = res.body.results.find((r) => r.category === 'Positive Credits');
    // oa1 should not see positive credits of faculty or negatives issued by oa2.
    expect(pos).toBeUndefined();
    expect(neg?.items.some((i) => i.id === CREDIT.f2NegByOa2)).toBeFalsy();
  });

  test('faculty search only returns own credits', async () => {
    const res = await api().get('/api/v1/search?q=credit').set(auth(T.faculty));
    const ids = res.body.results.flatMap((r) => r.items.map((i) => i.id));
    const own = new Set((await db.scan('credits')).filter((c) => c.faculty === ID.faculty1).map((c) => c._id));
    expect(ids.every((id) => own.has(id))).toBe(true);
  });

  test('another user cannot claim a registered push endpoint', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/victim';
    expect(
      (
        await api()
          .post('/api/v1/notifications/subscribe')
          .set(auth(T.faculty2))
          .send({ endpoint, keys: { p256dh: 'a', auth: 'b' } })
      ).status,
    ).toBe(201);
    expect(
      (
        await api()
          .post('/api/v1/notifications/subscribe')
          .set(auth(T.faculty))
          .send({ endpoint, keys: { p256dh: 'a', auth: 'b' } })
      ).status,
    ).toBe(409);
    expect((await db.get('pushSubs', endpoint, 'endpoint')).userId).toBe(ID.faculty2);
  });

  test("cannot mark another user's notification as read", async () => {
    const n = await require('../../../Models/Notification').create({ userId: ID.faculty2, title: 't' });
    expect((await api().patch(`/api/v1/notifications/${n._id}/read`).set(auth(T.faculty))).status).toBe(404);
  });
});

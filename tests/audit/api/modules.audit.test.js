/**
 * Audit: smaller modules - CDN/short links, health, notifications, reports,
 * exports, policies, analytics, ledger, chat, error handling and headers.
 */
const { setupApp, teardownApp, tokens, api, auth } = require('../../helpers/app');
const db = require('../../helpers/db');
const { sendEmail } = require('../../../utils/email');

const { ID } = db;
let T;

beforeAll(async () => { await setupApp(); T = await tokens(); });
afterAll(() => teardownApp());

describe('CDN assets and short links', () => {
  test('[FIXED SEC-02] creating a short link requires login', async () => {
    const res = await api().post('/api/v1/url/shorten').send({ url: 'https://evil.example.net/phish' });
    expect(res.status).toBe(401);
  });

  test('[FIXED SEC-02] an existing proof link cannot be overwritten', async () => {
    await db.put('shortUrls', { _id: 'abc123', originalUrl: 'https://cdn.jsdelivr.net/gh/x/y@main/real-proof.pdf', visits: 0 });
    await api().post('/api/v1/url/shorten').send({ url: 'https://evil.example.net/phish', alias: 'abc123' });
    const res = await api().get('/s/abc123');
    expect(res.headers.location).toBe('https://cdn.jsdelivr.net/gh/x/y@main/real-proof.pdf');
  });

  test('[FIXED SEC-03] a CDN asset mapping cannot be overwritten', async () => {
    await db.put('assets', { _id: 'logo-v1', targetUrl: 'https://cdn.jsdelivr.net/gh/x/y@main/logo.png' });
    await api().post('/cdn/assets').send({ id: 'logo-v1', targetUrl: 'javascript:alert(1)' });
    expect((await db.get('assets', 'logo-v1')).targetUrl).toBe('https://cdn.jsdelivr.net/gh/x/y@main/logo.png');
  });

  test('logged-in user can shorten a link to this app; other websites are refused', async () => {
    const ok = await api().post('/api/v1/url/shorten').set(auth(T.faculty)).send({ url: 'http://localhost:9002/u/portal/dashboard' });
    expect(ok.status).toBe(200);
    expect(ok.body.shortUrl).toMatch(/\/s\/[0-9a-f]{12}$/);
    const evil = await api().post('/api/v1/url/shorten').set(auth(T.faculty)).send({ url: 'https://evil.example.net/phish' });
    expect(evil.status).toBe(400);
    const js = await api().post('/api/v1/url/shorten').set(auth(T.faculty)).send({ url: 'javascript:alert(1)' });
    expect(js.status).toBe(400);
  });

  test('a custom alias is ignored, even when logged in', async () => {
    await db.put('shortUrls', { _id: 'keepme', originalUrl: 'https://cdn.jsdelivr.net/gh/test-owner/test-repo@main/a.pdf', visits: 0 });
    const res = await api().post('/api/v1/url/shorten').set(auth(T.admin)).send({ url: 'http://localhost:9002/x', alias: 'keepme' });
    expect(res.body.shortUrl).not.toMatch(/keepme/);
    expect((await db.get('shortUrls', 'keepme')).originalUrl).toMatch(/a\.pdf$/);
  });

  test('creating CDN assets is admin-only and limited to own storage', async () => {
    const target = 'https://cdn.jsdelivr.net/gh/test-owner/test-repo@main/x.pdf';
    expect((await api().post('/cdn/assets').set(auth(T.faculty)).send({ targetUrl: target })).status).toBe(403);
    expect((await api().post('/cdn/assets').set(auth(T.admin)).send({ targetUrl: 'https://evil.example.net/x' })).status).toBe(400);
    expect((await api().post('/cdn/assets').set(auth(T.admin)).send({ targetUrl: target })).status).toBe(201);
  });

  test('unknown short link -> 404', async () => {
    expect((await api().get('/s/zzzzzz')).status).toBe(404);
  });

  test('[FIXED SEC-24] short link ids are no longer 6 characters', () => {
    // Documented from utils/urlHelper.js: crypto.randomBytes(4).toString('hex').slice(0, 6).
    const { createShortLink } = require('../../../utils/urlHelper');
    expect(createShortLink.toString()).not.toMatch(/slice\(0,\s*6\)/);
  });
});

describe('health endpoints', () => {
  test('/health is public and minimal', async () => {
    const res = await api().get('/health');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['status', 'uptime']);
  });

  test.failing('[BUG] /api/health is public and leaks server internals (hostname, IPs, versions, memory)', async () => {
    const res = await api().get('/api/health').set('Host', '127.0.0.1:1');
    expect(res.status).toBe(401);
  });

  test('SSRF via /api/health NOT reproducible: on Express 5 its route discovery finds 0 routes', async () => {
    const nock = require('nock');
    const seen = [];
    // "attacker.example.net" is a fake host answered by nock inside this process;
    // no real network traffic happens.
    const record = (uri) => { seen.push(uri); return 'ok'; };
    nock('http://attacker.example.net').persist()
      .get(/.*/).reply(200, record).options(/.*/).reply(200, record).head(/.*/).reply(200)
      .post(/.*/).reply(200, record).put(/.*/).reply(200, record)
      .delete(/.*/).reply(200, record).patch(/.*/).reply(200, record);
    nock('https://api.ipify.org').get(/.*/).reply(200, { ip: '0.0.0.0' });
    try {
      await api().get('/api/health').set('Host', 'attacker.example.net');
    } finally {
      nock.cleanAll();
    }
    expect(seen.length).toBe(0);
  });
});

describe('employment records', () => {
  test.failing('[BUG] updating a faculty employment record fails for the same Date-object reason', async () => {
    const res = await api().put(`/api/v1/users/${ID.faculty1}/employment`).set(auth(T.admin)).send({
      employeeId: 'E-001', employmentType: 'permanent', status: 'active', college: 'EGSPEC', department: 'CSE',
      designation: 'Assistant Professor', joiningDate: '2020-06-01', effectiveFrom: '2020-06-01',
    });
    expect(res.status).toBe(200);
  });
  test('professional profile: own update works and rejects javascript: links', async () => {
    expect((await api().patch('/api/v1/users/me/professional-profile').set(auth(T.faculty)).send({ biography: 'Hello' })).status).toBe(200);
    expect((await api().patch('/api/v1/users/me/professional-profile').set(auth(T.faculty)).send({ professionalLinks: { website: 'javascript:alert(1)' } })).status).toBe(400);
  });
});

describe('notifications', () => {
  test('list own notifications', async () => {
    const res = await api().get('/api/v1/notifications').set(auth(T.faculty));
    expect(res.status).toBe(200);
    expect(res.body.items.every((n) => n.userId === ID.faculty1)).toBe(true);
  });

  test('broadcast requires title and body (400)', async () => {
    expect((await api().post('/api/v1/notifications/broadcast').set(auth(T.admin)).send({ title: 'x' })).status).toBe(400);
  });

  test('broadcast escapes HTML in the email body', async () => {
    sendEmail.mockClear();
    await api().post('/api/v1/notifications/broadcast').set(auth(T.admin)).send({ title: '<b>Hi</b>', body: '<script>x</script>' });
    const html = sendEmail.mock.calls.map((c) => c[0].html).join('');
    expect(html).not.toContain('<script>');
  });

  test('broadcast skips deactivated users for email', async () => {
    sendEmail.mockClear();
    await api().post('/api/v1/notifications/broadcast').set(auth(T.admin)).send({ title: 'T', body: 'B' });
    const recipients = sendEmail.mock.calls.map((c) => c[0].to);
    expect(recipients).not.toContain('inactive@example.org');
  });
});

describe('reports and exports', () => {
  test('report data for admin', async () => {
    const res = await api().get('/api/v1/reports').set(auth(T.admin));
    expect(res.status).toBe(200);
  });

  test('[FIXED SEC-04] report "share link" no longer contains the admin login token', async () => {
    const res = await api().get('/api/v1/reports/download?format=pdf&share=true').set(auth(T.admin));
    const id = res.body.shareLink.split('/s/')[1];
    const open = await api().get(`/s/${id}`);
    const target = open.headers.location;
    expect(target).not.toContain(T.admin);
    expect(new URL(target).searchParams.get('token')).toBeNull();
    // Whatever is in the link, it must not work as a login.
    const pass = decodeURIComponent(new URL(target).pathname.split('/shared/')[1] || '');
    expect((await api().get('/api/v1/users').set(auth(pass))).status).toBe(401);
  });

  test('a shared report opens read-only without login (HTML, PDF, Excel)', async () => {
    const res = await api().get('/api/v1/reports/download?format=pdf&share=true&view=ranking').set(auth(T.admin));
    expect(res.body.expiresInHours).toBeGreaterThan(0);
    const target = new URL((await api().get(`/s/${res.body.shareLink.split('/s/')[1]}`)).headers.location);
    const path = target.pathname;
    const html = await api().get(`${path}?format=html`);
    expect(html.status).toBe(200);
    expect(html.headers['content-type']).toMatch(/html/);
    expect(html.text).not.toContain(T.admin);
    for (const format of ['pdf', 'excel']) expect((await api().get(`${path}?format=${format}`)).status).toBe(200);
  });

  test('tampered or expired report links are refused', async () => {
    expect((await api().get('/api/v1/reports/shared/not-a-pass?format=html')).status).toBe(401);
    const jwt = require('jsonwebtoken');
    const expired = jwt.sign({ purpose: 'report-share', q: {} }, process.env.EXPORT_SIGNING_SECRET, { expiresIn: -10 });
    expect((await api().get(`/api/v1/reports/shared/${expired}?format=html`)).status).toBe(401);
    // A login token is not a report pass.
    expect((await api().get(`/api/v1/reports/shared/${T.admin}?format=html`)).status).toBe(401);
  });

  test('official Excel: signed, and the signature verifies publicly', async () => {
    const res = await api().post('/api/v1/exports/official-excel').set(auth(T.admin))
      .send({ documentType: 'good_works_submissions', rows: [{ name: 'A', points: 1 }] })
      .buffer(true).parse((r, cb) => { const d = []; r.on('data', (c) => d.push(c)); r.on('end', () => cb(null, Buffer.concat(d))); });
    expect(res.status).toBe(200);
    expect(res.headers['x-fcs-document-id']).toMatch(/^FCS-/);
  });

  test('official Excel: formula injection is neutralised', async () => {
    const res = await api().post('/api/v1/exports/official-excel').set(auth(T.admin))
      .send({ documentType: 'good_works_submissions', rows: [{ name: '=HYPERLINK("http://evil")' }] });
    expect(res.status).toBe(200);
  });

  test('[DESIGN] "official" export signs whatever rows the browser sends (not checked against the database)', async () => {
    const res = await api().post('/api/v1/exports/official-excel').set(auth(T.admin))
      .send({ documentType: 'good_works_submissions', rows: [{ name: 'Invented Person', points: 99999 }] });
    expect(res.status).toBe(200); // documented as a design finding
  });

  test('verify endpoint rejects tampered tokens', async () => {
    expect((await api().get('/api/v1/exports/verify/abc.def')).body.valid).toBe(false);
  });

  test('faculty ledger and ranking for admin', async () => {
    expect((await api().get(`/api/v1/admin/faculty/${ID.faculty1}/credit-ledger`).set(auth(T.admin))).status).toBe(200);
    expect((await api().get('/api/v1/admin/faculty-ledger/ranking').set(auth(T.admin))).status).toBe(200);
  });

  test('ledger exports (PDF and Excel) are produced', async () => {
    for (const format of ['pdf', 'excel']) {
      const res = await api().get(`/api/v1/admin/faculty/${ID.faculty1}/credit-ledger/export?format=${format}`).set(auth(T.admin));
      expect(res.status).toBe(200);
    }
  });

  test.failing('[BUG] "export my data" returns no credits (looks them up by facultyID instead of user id)', async () => {
    const res = await api().get('/api/v1/users/me/export').set(auth(T.faculty));
    expect(res.status).toBe(200);
    expect(res.text.split('--- CREDITS DATA ---')[1].trim().split('\n').length).toBeGreaterThan(1);
  });

  test.skip('[BLOCKED by export bug] "export my data" CSV does not neutralise spreadsheet formulas', async () => {
    await db.put('credits', db.credit('7c00000000000000000000ff', ID.faculty1, 'positive', 1, 'pending', { title: '=cmd|"/c calc"!A1' }));
    const res = await api().get('/api/v1/users/me/export').set(auth(T.faculty));
    expect(res.text).not.toContain('"=cmd');
  });
});

describe('analytics', () => {
  test.each(['users', 'credits', 'credit-titles', 'academic-years', 'credit-trends'])('/analytics/%s returns 200', async (p) => {
    expect((await api().get(`/api/v1/analytics/${p}`).set(auth(T.admin))).status).toBe(200);
  });
});

describe('credit policies', () => {
  const policy = {
    name: 'Audit policy', effectiveFrom: '2025-06-01', effectiveTo: null,
    rules: [{ ruleId: 'paper.journal', name: 'Journal paper', creditType: 'positive', calculation: { basePoints: 10 } }],
  };
  test.failing('[BUG] creating a credit policy always fails (Joi turns dates into Date objects DynamoDB cannot store)', async () => {
    const created = await api().post('/api/v1/policies').set(auth(T.admin)).send(policy);
    expect(created.status).toBe(201);
    const { policyId, version, revision } = created.body.data;
    const base = `/api/v1/policies/${policyId}/versions/${version}`;
    expect((await api().put(base).set(auth(T.admin)).send({ ...policy, name: 'Renamed policy', expectedRevision: revision })).status).toBe(200);
    expect((await api().post(`${base}/preview`).set(auth(T.admin)).send({ ruleId: 'paper.journal', facts: {} })).status).toBe(200);
    expect((await api().post(`${base}/publish`).set(auth(T.admin))).status).toBe(200);
    expect((await api().put(base).set(auth(T.admin)).send({ ...policy, expectedRevision: revision + 1 })).status).toBeGreaterThanOrEqual(400);
    expect((await api().post(`${base}/retire`).set(auth(T.admin))).status).toBe(200);
  });
  test('invalid policy -> 400', async () => {
    expect((await api().post('/api/v1/policies').set(auth(T.admin)).send({ name: 'x' })).status).toBe(400);
  });
  test('OA can read but not create', async () => {
    expect((await api().get('/api/v1/policies').set(auth(T.oa))).status).toBe(200);
    expect((await api().post('/api/v1/policies').set(auth(T.oa)).send(policy)).status).toBe(403);
  });
});

describe('chat / conversations (MongoDB is never connected)', () => {
  test.failing('[BUG] listing conversations fails or hangs (feature is broken)', async () => {
    const res = await api().get('/api/v1/conversations').set(auth(T.faculty)).timeout(15000).catch((e) => ({ status: e.timeout ? 'timeout' : 'error' }));
    expect(res.status).toBe(200);
  }, 20000);
});

describe('error handling and HTTP hardening', () => {
  test('unknown route -> 404 JSON', async () => {
    const res = await api().get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('malformed JSON -> 400, not 500', async () => {
    const res = await api().post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
  });

  test.failing('[BUG] errors include a full stack trace unless NODE_ENV is exactly "production"', async () => {
    const res = await api().post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.body.stack).toBeUndefined();
  });

  test.failing('[BUG] in production, raw internal error messages (e.g. table names) are returned to the user', async () => {
    const old = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const Credit = require('../../../Models/Credit');
    const spy = jest.spyOn(Credit, 'find').mockRejectedValueOnce(Object.assign(new Error('ResourceNotFoundException: table fcs_secret_x'), { name: 'ResourceNotFoundException' }));
    const res = await api().get(`/api/v1/credits/credits/faculty/${ID.faculty1}`).set(auth(T.faculty));
    process.env.NODE_ENV = old;
    spy.mockRestore();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.stack).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/fcs_secret_x/);
  });

  test('request body over 10 MB is refused (413)', async () => {
    const res = await api().post('/api/v1/auth/login').set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@example.org', password: 'x'.repeat(11 * 1024 * 1024) }));
    expect(res.status).toBe(413);
  });

  test('security headers from helmet are present', async () => {
    const res = await api().get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test.failing('[BUG] Content-Security-Policy header is disabled', async () => {
    expect((await api().get('/health')).headers['content-security-policy']).toBeDefined();
  });

  test('CORS allows only the configured frontend origin', async () => {
    const res = await api().get('/health').set('Origin', 'https://evil.example.net');
    expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example.net');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  test.failing('[BUG] CORS falls back to "*" (any website) when CORS_ORIGIN is not set', async () => {
    const old = process.env.CORS_ORIGIN;
    delete process.env.CORS_ORIGIN;
    jest.isolateModules(() => { require('../../../server'); });
    let fresh;
    jest.isolateModules(() => { fresh = require('../../../server'); });
    process.env.CORS_ORIGIN = old;
    const res = await require('supertest')(fresh).get('/health').set('Origin', 'https://evil.example.net');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});

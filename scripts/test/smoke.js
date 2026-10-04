/**
 * Smoke test: one quick check that the whole backend starts and answers.
 * Starts the local test server (DynamoDB Local + fake services), then checks
 * health, login per role and one main API per role. Prints ✅/❌ per step.
 *
 *   node scripts/test/smoke.js
 *   SMOKE_FRONTEND=http://localhost:9002 node scripts/test/smoke.js   (also checks the website)
 */
const { spawn } = require('child_process');
const path = require('path');

const PORT = 5070;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'Test-Passw0rd-123!';
let failures = 0;

async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`✅ ${name}${detail ? ` - ${detail}` : ''}`);
  } catch (e) {
    failures++;
    console.log(`❌ ${name} - ${e.message}`);
  }
}
async function req(method, url, token, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const expectStatus = (r, s) => { if (r.status !== s) throw new Error(`expected ${s}, got ${r.status}`); return `HTTP ${r.status}`; };

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', '..', 'tests', 'support', 'testServer.js')], {
    env: { ...process.env, TEST_SERVER_PORT: String(PORT), TEST_SERVER_PREFIX: 'fcs_smoke' }, stdio: 'ignore',
  });
  try {
    await check('Backend starts and /health answers', async () => {
      for (let i = 0; i < 60; i++) {
        try { const r = await fetch(`${BASE}/health`); if (r.ok) return 'HTTP 200'; } catch { /* starting */ }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error('no answer after 30 s');
    });

    await check('Database reachable (/health/ready)', async () => {
      const r = await fetch(`${BASE}/health/ready`);
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      return 'HTTP 200';
    });

    const tokens = {};
    for (const [role, email] of [['admin', 'admin@example.org'], ['oa', 'oa1@example.org'], ['faculty', 'faculty1@example.org']]) {
      await check(`Login as ${role}`, async () => {
        const r = await req('POST', '/api/v1/auth/login', null, { email, password: PASSWORD });
        expectStatus(r, 200);
        tokens[role] = r.body.data.token;
        return 'token received';
      });
    }

    await check('Faculty: own credits list', async () => expectStatus(await req('GET', '/api/v1/credits/credits/faculty/5a0000000000000000000005', tokens.faculty), 200));
    await check('Faculty: credit summary', async () => expectStatus(await req('GET', '/api/v1/credits/5a0000000000000000000005/credits', tokens.faculty), 200));
    await check('Faculty: blocked from admin API', async () => expectStatus(await req('GET', '/api/v1/admin/credits/positive', tokens.faculty), 403));
    await check('OA: issued credits', async () => expectStatus(await req('GET', '/api/v1/admin/oa/credits/issued', tokens.oa), 200));
    await check('Admin: positive credits for review', async () => expectStatus(await req('GET', '/api/v1/admin/credits/positive', tokens.admin), 200));
    await check('Admin: user list', async () => expectStatus(await req('GET', '/api/v1/users', tokens.admin), 200));
    await check('Admin: analytics', async () => expectStatus(await req('GET', '/api/v1/analytics/credits', tokens.admin), 200));
    await check('Anonymous: protected API refused', async () => expectStatus(await req('GET', '/api/v1/users'), 401));

    if (process.env.SMOKE_FRONTEND) {
      for (const p of ['/u/portal/auth', '/u/portal/dashboard']) {
        await check(`Website page ${p}`, async () => {
          const r = await fetch(`${process.env.SMOKE_FRONTEND}${p}`);
          if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
          return `HTTP ${r.status}`;
        });
      }
    }
  } finally {
    server.kill();
  }
  console.log(failures ? `\n${failures} smoke check(s) FAILED` : '\nAll smoke checks passed');
  process.exit(failures ? 1 : 0);
})();

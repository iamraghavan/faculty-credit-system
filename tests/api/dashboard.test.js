const { setupApp, teardownApp, tokens, api, auth } = require('../helpers/app');
const db = require('../helpers/db');
const { creditImpact } = require('../../domain/creditAccounting');

let T;
beforeAll(async () => {
  await setupApp();
  T = await tokens();
});
afterAll(() => teardownApp());

test('admin dashboard reports real year-scoped queues, points and chart data', async () => {
  const response = await api().get('/api/v1/analytics/dashboard?academicYear=2025-26').set(auth(T.admin));
  expect(response.status).toBe(200);
  const data = response.body;
  const credits = (await db.scan('credits')).filter(
    (item) => item.status !== 'deleted' && item.academicYear === '2025-2026',
  );
  expect(data.academicYear).toBe('2025-26');
  expect(data.summary.totalRecords).toBe(credits.length);
  expect(data.summary.pendingReview).toBe(
    credits.filter((item) => item.type === 'positive' && item.status === 'pending').length,
  );
  expect(data.summary.openAppeals).toBe(credits.filter((item) => item.appeal?.status === 'pending').length);
  expect(data.summary.netPoints).toBe(credits.reduce((sum, item) => sum + creditImpact(item).points, 0));
  expect(data.status.pending + data.status.approved + data.status.rejected).toBe(
    credits.filter((item) => item.type === 'positive').length,
  );
  expect(data.trends.length).toBeGreaterThan(0);
  expect(data.colleges.some((item) => item.records > 0)).toBe(true);
  expect(data.recent.length).toBeGreaterThan(0);
  expect(data.recent.length).toBeLessThanOrEqual(6);
  expect(data.recent[0]).not.toHaveProperty('password');
  expect(data.recent.every((item) => typeof item.impact === 'number')).toBe(true);
});

test('year filter accepts legacy spelling and returns empty scoped state', async () => {
  const short = (await api().get('/api/v1/analytics/dashboard?academicYear=2025-26').set(auth(T.admin))).body;
  const full = (await api().get('/api/v1/analytics/dashboard?academicYear=2025-2026').set(auth(T.admin))).body;
  expect(full.summary.totalRecords).toBe(short.summary.totalRecords);
  const empty = await api().get('/api/v1/analytics/dashboard?academicYear=2024-25').set(auth(T.admin));
  expect(empty.status).toBe(200);
  expect(empty.body.summary.totalRecords).toBe(0);
  expect(empty.body.summary.pendingReview).toBe(0);
  expect(empty.body.summary.netPoints).toBe(0);
  expect(empty.body.trends).toEqual([]);
});

test('dashboard rejects invalid years and keeps admin data private', async () => {
  expect((await api().get('/api/v1/analytics/dashboard?academicYear=bad').set(auth(T.admin))).status).toBe(400);
  expect((await api().get('/api/v1/analytics/dashboard')).status).toBe(401);
  expect((await api().get('/api/v1/analytics/dashboard').set(auth(T.faculty))).status).toBe(403);
  expect((await api().get('/api/v1/analytics/dashboard').set(auth(T.oa))).status).toBe(403);
});

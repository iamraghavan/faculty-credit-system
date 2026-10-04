/**
 * Audit: the real global rate limiter (200 requests per 15 minutes per IP).
 */
jest.unmock('../../../Middleware/rateLimitMiddleware');
const { setupApp, teardownApp, api } = require('../../helpers/app');

beforeAll(() => setupApp({ seed: false }));
afterAll(() => teardownApp());

test('the 201st request from one IP in 15 minutes gets 429', async () => {
  let last;
  for (let i = 0; i < 201; i++) last = await api().get('/api/v1/exports/verify/x.y').set('X-Forwarded-For', '203.0.113.7');
  expect(last.status).toBe(429);
});

test.failing('[BUG] /api/health (the expensive one) is mounted BEFORE the limiter (never limited)', async () => {
  let last;
  for (let i = 0; i < 205; i++) last = await api().get('/api/health').set('X-Forwarded-For', '203.0.113.8');
  expect(last.status).toBe(429);
});

test('[CONDITIONAL] client-supplied X-Forwarded-For decides the IP (trust proxy = 1)', async () => {
  // Behind Vercel the platform rewrites this header, so this is only exploitable when the
  // backend is reached directly (self-hosted index.js). Documented, not asserted as a bug.
  for (let i = 0; i < 201; i++) await api().get('/api/v1/exports/verify/x.y').set('X-Forwarded-For', '203.0.113.9');
  const fresh = await api().get('/api/v1/exports/verify/x.y').set('X-Forwarded-For', '198.51.100.1');
  expect(fresh.status).not.toBe(429);
});

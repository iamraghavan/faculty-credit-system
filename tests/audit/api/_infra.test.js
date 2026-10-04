const { setupApp, teardownApp, login, api, auth } = require('../../helpers/app');
const { ID } = require('../../helpers/db');
beforeAll(() => setupApp());
afterAll(() => teardownApp());
test('infra: tables are local and login works', async () => {
  expect(process.env.AWS_ENDPOINT_URL_DYNAMODB).toMatch(/127\.0\.0\.1/);
  const token = await login('faculty1@example.org');
  const res = await api().get(`/api/v1/credits/credits/faculty/${ID.faculty1}`).set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body.total).toBeGreaterThan(0);
});
test('infra: outside network is blocked', async () => {
  const axios = require('axios');
  await expect(axios.get('https://example.com')).rejects.toThrow(/Nock|Disallowed|net connect/i);
});

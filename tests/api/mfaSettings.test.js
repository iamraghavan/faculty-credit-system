const speakeasy = require('speakeasy');
const { setupApp, teardownApp, tokenFor, api, auth } = require('../helpers/app');
const db = require('../helpers/db');
const { sendEmail } = require('../../utils/email');

beforeAll(() => setupApp());
afterAll(() => teardownApp());

test('authenticator setup verifies the server-held pending secret and requires proof to disable', async () => {
  const bearer = auth(await tokenFor(db.ID.faculty1, 'faculty'));
  const start = await api().post('/api/v1/users/me/mfa/setup').set(bearer).send({ type: 'app' });
  expect(start.status).toBe(200);
  expect(start.body.qrCode).toMatch(/^data:image\/png;base64,/);
  expect(start.body).not.toHaveProperty('secret');
  const pending = (await db.get('users', db.ID.faculty1)).mfaPendingSecret;
  const code = speakeasy.totp({ secret: pending, encoding: 'base32' });
  expect((await api().post('/api/v1/users/me/mfa/enable').set(bearer).send({ type: 'app', token: code })).status).toBe(
    200,
  );
  expect((await api().post('/api/v1/users/me/mfa/disable').set(bearer).send({ token: code })).status).toBe(403);
  expect(
    (await api().post('/api/v1/users/me/mfa/disable').set(bearer).send({ token: code, currentPassword: db.PASSWORD }))
      .status,
  ).toBe(200);
});

test('email setup sends and verifies a single-use code', async () => {
  const bearer = auth(await tokenFor(db.ID.faculty2, 'faculty'));
  sendEmail.mockClear();
  const start = await api().post('/api/v1/users/me/mfa/setup').set(bearer).send({ type: 'email' });
  expect(start.status).toBe(200);
  const code = sendEmail.mock.calls[0][0].text.match(/code is: (\d{6})/)[1];
  const stored = await db.get('users', db.ID.faculty2);
  expect(stored.mfaPendingEmailCode).not.toBe(code);
  expect(
    (await api().post('/api/v1/users/me/mfa/enable').set(bearer).send({ type: 'email', token: '000000' })).status,
  ).toBe(400);
  expect(
    (await api().post('/api/v1/users/me/mfa/enable').set(bearer).send({ type: 'email', token: code })).status,
  ).toBe(200);
  expect((await db.get('users', db.ID.faculty2)).mfaPendingEmailCode).toBeNull();
  expect(
    (await api().post('/api/v1/users/me/mfa/disable').set(bearer).send({ currentPassword: db.PASSWORD })).status,
  ).toBe(200);
});

test('email setup reports delivery failure without exposing SMTP details', async () => {
  const bearer = auth(await tokenFor(db.ID.faculty2, 'faculty'));
  sendEmail.mockRejectedValueOnce(new Error('Connection closed'));
  const response = await api().post('/api/v1/users/me/mfa/setup').set(bearer).send({ type: 'email' });
  expect(response.status).toBe(503);
  expect(response.body.message).toBe('Could not send the verification email. Please try again later.');
  expect(JSON.stringify(response.body)).not.toContain('Connection closed');
});

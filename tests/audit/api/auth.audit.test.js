/**
 * Audit: authentication, MFA, sessions, password reset (real app + DynamoDB Local).
 */
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const { setupApp, teardownApp, login, tokenFor, api, auth } = require('../../helpers/app');
const db = require('../../helpers/db');
const { sendEmail } = require('../../../utils/email');
const { sendWhatsAppMessage } = require('../../../utils/whatsapp');

const { ID, PASSWORD } = db;
const LOGIN = '/api/v1/auth/login';

beforeAll(() => setupApp());
afterAll(() => teardownApp());

describe('POST /auth/login', () => {
  test.each(['superadmin', 'admin', 'oa1', 'faculty1'])('%s can log in and gets a session-bound token', async (who) => {
    const res = await api()
      .post(LOGIN)
      .send({ email: `${who}@example.org`, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    const decoded = jwt.verify(res.body.data.token, process.env.JWT_SECRET);
    expect(decoded.sessionId).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/); // no bcrypt hash leaked
    expect(res.body.data).not.toHaveProperty('password');
  });

  test('email is case-insensitive', async () => {
    const res = await api().post(LOGIN).send({ email: 'FACULTY1@EXAMPLE.ORG', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  test('wrong password -> 401 generic message', async () => {
    const res = await api().post(LOGIN).send({ email: 'faculty1@example.org', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');
  });

  test('unknown email -> 401 same generic message', async () => {
    const res = await api().post(LOGIN).send({ email: 'nobody@example.org', password: 'whatever' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');
  });

  test('missing / wrong-type fields -> 400', async () => {
    expect((await api().post(LOGIN).send({})).status).toBe(400);
    expect((await api().post(LOGIN).send({ email: 'faculty1@example.org' })).status).toBe(400);
    expect(
      (
        await api()
          .post(LOGIN)
          .send({ email: ['a'], password: 1 })
      ).status,
    ).toBe(400);
    expect((await api().post(LOGIN).send({ email: 'not-an-email', password: 'x' })).status).toBe(400);
  });

  test('NoSQL-style operator objects are rejected', async () => {
    const res = await api()
      .post(LOGIN)
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
  });

  test.failing('[BUG] inactive account is revealed WITHOUT knowing the password (account enumeration)', async () => {
    const res = await api().post(LOGIN).send({ email: 'inactive@example.org', password: 'wrong-password' });
    expect(res.status).toBe(401); // should look exactly like a wrong password
  });

  test('inactive account with the right password is refused', async () => {
    const res = await api().post(LOGIN).send({ email: 'inactive@example.org', password: PASSWORD });
    expect(res.status).toBe(403);
  });

  test.failing('[BUG] no account lockout: 25 wrong passwords, then the right one still works immediately', async () => {
    for (let i = 0; i < 25; i++) {
      await api()
        .post(LOGIN)
        .send({ email: 'faculty2@example.org', password: `guess-${i}` });
    }
    const res = await api().post(LOGIN).send({ email: 'faculty2@example.org', password: PASSWORD });
    expect(res.status).toBe(429); // expected: temporarily locked / throttled per account
  });

  test.failing('[BUG] captcha (Turnstile) is not verified by the server', async () => {
    const res = await api().post(LOGIN).send({ email: 'faculty1@example.org', password: PASSWORD });
    // No turnstileToken was sent, yet login succeeded.
    expect(res.status).toBe(400);
  });
});

describe('MFA', () => {
  test('app MFA: password alone -> mfaRequired, no token', async () => {
    const res = await api().post(LOGIN).send({ email: 'mfa-app@example.org', password: PASSWORD });
    expect(res.body).toMatchObject({ mfaRequired: true, mfaType: 'app' });
    expect(res.body.data?.token).toBeUndefined();
  });

  test('app MFA: valid TOTP -> token; wrong TOTP -> 400', async () => {
    const good = speakeasy.totp({ secret: db.MFA_SECRET, encoding: 'base32' });
    const ok = await api().post(LOGIN).send({ email: 'mfa-app@example.org', password: PASSWORD, token: good });
    expect(ok.status).toBe(200);
    expect(ok.body.data.token).toBeTruthy();
    const badCode = good === '000000' ? '111111' : '000000';
    const bad = await api().post(LOGIN).send({ email: 'mfa-app@example.org', password: PASSWORD, token: badCode });
    expect(bad.status).toBe(400);
  });

  /** Password step for the email-MFA user; returns the ticket and the emailed code. */
  async function emailMfaStep() {
    sendEmail.mockClear();
    const res = await api().post(LOGIN).send({ email: 'mfa-email@example.org', password: PASSWORD });
    expect(res.body).toMatchObject({ mfaRequired: true, mfaType: 'email' });
    expect(res.body.mfaTicket).toBeTruthy();
    const mail = sendEmail.mock.calls.find((c) => c[0].to === 'mfa-email@example.org')[0];
    const code = mail.text.match(/\b(\d{6})\b/)[1];
    return { ticket: res.body.mfaTicket, code };
  }
  const resetMfaUser = async () =>
    db.put('users', { ...(await db.get('users', ID.mfaEmail)), mfaFailedAttempts: 0, mfaLockedUntil: null });

  test('email MFA: code is emailed and verify-mfa (with ticket) returns a session-bound token', async () => {
    await resetMfaUser();
    const { ticket, code } = await emailMfaStep();
    const v = await api().post('/api/v1/auth/verify-mfa').send({ mfaTicket: ticket, code });
    expect(v.status).toBe(200);
    expect(v.body.data.token).toBeTruthy();
    expect(jwt.decode(v.body.data.token).sessionId).toBeTruthy();
  });

  test('email MFA code cannot be reused', async () => {
    await resetMfaUser();
    const { ticket, code } = await emailMfaStep();
    expect((await api().post('/api/v1/auth/verify-mfa').send({ mfaTicket: ticket, code })).status).toBe(200);
    expect((await api().post('/api/v1/auth/verify-mfa').send({ mfaTicket: ticket, code })).status).toBe(400);
  });

  test('[FIXED SEC-25] email MFA code is not stored in plain text', async () => {
    await resetMfaUser();
    const { code } = await emailMfaStep();
    const stored = (await db.get('users', ID.mfaEmail)).mfaCode;
    expect(stored).not.toBe(code);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  test('[FIXED SEC-07] wrong MFA codes are limited: after 5, the code is cancelled and the account paused', async () => {
    await resetMfaUser();
    const { ticket, code } = await emailMfaStep();
    let last;
    for (let i = 0; i < 5; i++) {
      const guess = String(100000 + i) === code ? '999999' : String(100000 + i);
      last = await api().post('/api/v1/auth/verify-mfa').send({ mfaTicket: ticket, code: guess });
    }
    expect(last.status).toBe(429);
    expect((await api().post('/api/v1/auth/verify-mfa').send({ mfaTicket: ticket, code })).status).toBe(429);
    // Even the password step is paused for this account while locked.
    expect((await api().post(LOGIN).send({ email: 'mfa-email@example.org', password: PASSWORD })).status).toBe(429);
    await resetMfaUser();
  });

  test('[FIXED SEC-06] verify-mfa no longer accepts a userId (or email) instead of the password step', async () => {
    const totp = speakeasy.totp({ secret: db.MFA_SECRET, encoding: 'base32' });
    expect((await api().post('/api/v1/auth/verify-mfa').send({ userId: ID.mfaApp, code: totp })).status).toBe(401);
    expect(
      (await api().post('/api/v1/auth/verify-mfa').send({ email: 'mfa-app@example.org', code: totp })).status,
    ).toBe(401);
  });

  test('verify-mfa: forged, expired or login tokens are not accepted as tickets', async () => {
    const totp = speakeasy.totp({ secret: db.MFA_SECRET, encoding: 'base32' });
    const forged = jwt.sign({ purpose: 'mfa-login', uid: ID.mfaApp }, 'attacker-secret');
    const expired = jwt.sign({ purpose: 'mfa-login', uid: ID.mfaApp }, process.env.JWT_SECRET, { expiresIn: -5 });
    const loginToken = await tokenFor(ID.mfaApp, 'faculty');
    for (const t of [forged, expired, loginToken]) {
      expect((await api().post('/api/v1/auth/verify-mfa').send({ mfaTicket: t, code: totp })).status).toBe(401);
    }
  });

  test('app MFA: ticket + valid TOTP logs in', async () => {
    const step = await api().post(LOGIN).send({ email: 'mfa-app@example.org', password: PASSWORD });
    const totp = speakeasy.totp({ secret: db.MFA_SECRET, encoding: 'base32' });
    const v = await api()
      .post('/api/v1/auth/verify-mfa')
      .send({ mfaTicket: step.body.mfaTicket, code: totp, type: 'app' });
    expect(v.status).toBe(200);
  });

  test('an MFA ticket cannot be used as a login token', async () => {
    const step = await api().post(LOGIN).send({ email: 'mfa-app@example.org', password: PASSWORD });
    expect((await api().get('/api/v1/auth/profile').set(auth(step.body.mfaTicket))).status).toBe(401);
  });

  test('MFA cannot be switched off with only a login token', async () => {
    const t = await tokenFor(ID.mfaApp, 'faculty');
    const res = await api().post('/api/v1/auth/mfa/disable-all').set(auth(t)).send({});
    expect(res.status).toBe(403);
    expect((await db.get('users', ID.mfaApp)).mfaAppEnabled).toBe(true);
  });

  test('app MFA setup: verify requires a valid code, then enables MFA', async () => {
    const t = await tokenFor(ID.faculty2, 'faculty');
    const start = await api().post('/api/v1/auth/mfa/enable-app').set(auth(t));
    expect(start.status).toBe(200);
    expect(start.body.base32Secret).toBeTruthy();
    expect((await api().post('/api/v1/auth/mfa/verify-app-setup').set(auth(t)).send({ token: 'abc' })).status).toBe(
      400,
    );
    const code = speakeasy.totp({ secret: start.body.base32Secret, encoding: 'base32' });
    expect((await api().post('/api/v1/auth/mfa/verify-app-setup').set(auth(t)).send({ token: code })).status).toBe(200);
    expect((await db.get('users', ID.faculty2)).mfaAppEnabled).toBe(true);
    await api()
      .post('/api/v1/auth/mfa/disable-all')
      .set(auth(t))
      .send({
        currentPassword: PASSWORD,
        token: speakeasy.totp({ secret: start.body.base32Secret, encoding: 'base32' }),
      });
  });
});

describe('token validation (authMiddleware)', () => {
  const PROFILE = '/api/v1/auth/profile';
  test('no token -> 401', async () => expect((await api().get(PROFILE)).status).toBe(401));
  test('garbage token -> 401', async () =>
    expect((await api().get(PROFILE).set(auth('abc.def.ghi'))).status).toBe(401));
  test('token signed with another secret -> 401', async () => {
    const t = jwt.sign({ id: ID.admin, role: 'admin' }, 'attacker-secret');
    expect((await api().get(PROFILE).set(auth(t))).status).toBe(401);
  });
  test('"alg: none" token -> 401', async () => {
    const t = jwt.sign({ id: ID.admin, role: 'admin' }, null, { algorithm: 'none' });
    expect((await api().get(PROFILE).set(auth(t))).status).toBe(401);
  });
  test('expired token -> 401', async () => {
    const t = await tokenFor(ID.faculty1, 'faculty', { expiresIn: -10 });
    expect((await api().get(PROFILE).set(auth(t))).status).toBe(401);
  });
  test('token for a user that does not exist -> 401', async () => {
    const t = jwt.sign({ id: '5a00000000000000000000ff', role: 'admin' }, process.env.JWT_SECRET);
    expect((await api().get(PROFILE).set(auth(t))).status).toBe(401);
  });
  test('inactive user with valid token -> 403', async () => {
    const t = await tokenFor(ID.inactive, 'faculty');
    expect((await api().get(PROFILE).set(auth(t))).status).toBe(403);
  });
  test('the role inside the token is NOT trusted (role comes from the database)', async () => {
    const t = await tokenFor(ID.faculty1, 'admin');
    expect((await api().get('/api/v1/admin/credits/positive').set(auth(t))).status).toBe(403);
  });
  test('revoked session -> 401', async () => {
    const t = await tokenFor(ID.faculty1, 'faculty');
    const { sessionId } = jwt.decode(t);
    await require('../../../Models/Session').revoke(sessionId);
    expect((await api().get(PROFILE).set(auth(t))).status).toBe(401);
  });
  test("using another user's session id -> 401", async () => {
    const other = jwt.decode(await tokenFor(ID.faculty2, 'faculty')).sessionId;
    const t = jwt.sign({ id: ID.faculty1, role: 'faculty', sessionId: other }, process.env.JWT_SECRET);
    expect((await api().get(PROFILE).set(auth(t))).status).toBe(401);
  });
  test('a token without a session is rejected', async () => {
    const t = await tokenFor(ID.faculty1, 'faculty', { withSession: false });
    expect((await api().get(PROFILE).set(auth(t))).status).toBe(401);
  });
  test('[FIXED SEC-21] login token is no longer accepted in the URL query string', async () => {
    const t = await tokenFor(ID.faculty1, 'faculty');
    expect((await api().get(`${PROFILE}?token=${t}`)).status).toBe(401);
  });
});

describe('sessions, refresh, logout', () => {
  test('[FIXED SEC-09] a refreshed token is revoked together with its session', async () => {
    const t = await tokenFor(ID.faculty1, 'faculty');
    const res = await api().get('/api/v1/auth/refresh').set(auth(t));
    expect(res.status).toBe(200);
    const fresh = res.body.token;
    await require('../../../Models/Session').revoke(jwt.decode(t).sessionId);
    // The original session is revoked, so the refreshed token should stop working too.
    expect((await api().get('/api/v1/auth/profile').set(auth(fresh))).status).toBe(401);
  });

  test('[FIXED SEC-10] logout ends the session on the server (token stops working)', async () => {
    const t = await tokenFor(ID.faculty1, 'faculty');
    expect((await api().get('/api/v1/auth/profile').set(auth(t))).status).toBe(200);
    const res = await api().post('/api/v1/auth/logout').set(auth(t));
    expect(res.status).toBe(200);
    expect((await api().get('/api/v1/auth/profile').set(auth(t))).status).toBe(401);
  });

  test('a token without a session cannot be refreshed', async () => {
    const t = await tokenFor(ID.faculty1, 'faculty', { withSession: false });
    expect((await api().get('/api/v1/auth/refresh').set(auth(t))).status).toBe(401);
  });

  test('change password keeps the current session working', async () => {
    const t = await tokenFor(ID.oa2, 'oa');
    await api()
      .post('/api/v1/auth/change-password')
      .set(auth(t))
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD, confirmPassword: PASSWORD });
    expect((await api().get('/api/v1/auth/profile').set(auth(t))).status).toBe(200);
  });

  test('session list returns only own sessions', async () => {
    const t = await tokenFor(ID.faculty1, 'faculty');
    const res = await api().get('/api/v1/auth/sessions').set(auth(t));
    expect(res.status).toBe(200);
    expect(res.body.sessions.every((s) => s.userId === ID.faculty1)).toBe(true);
  });

  test("cannot revoke another user's session", async () => {
    const otherSid = jwt.decode(await tokenFor(ID.faculty2, 'faculty')).sessionId;
    const t = await tokenFor(ID.faculty1, 'faculty');
    expect((await api().delete(`/api/v1/auth/sessions/${otherSid}`).set(auth(t))).status).toBe(404);
  });

  test('[FIXED B-38a] "log out all other devices" works', async () => {
    const other = await tokenFor(ID.oa2, 'oa');
    const current = await tokenFor(ID.oa2, 'oa');
    const res = await api().delete('/api/v1/auth/sessions/others').set(auth(current));
    expect(res.status).toBe(200);
    expect((await api().get('/api/v1/auth/profile').set(auth(other))).status).toBe(401);
  });

  test('more than MAX_ACTIVE_SESSIONS logins revokes the oldest session', async () => {
    const first = await login('oa1@example.org');
    for (let i = 0; i < 5; i++) await login('oa1@example.org');
    expect((await api().get('/api/v1/auth/profile').set(auth(first))).status).toBe(401);
  });
});

describe('password change and reset', () => {
  test('change password: wrong current -> 401, mismatch -> 400', async () => {
    const t = await tokenFor(ID.faculty2, 'faculty');
    expect(
      (
        await api()
          .post('/api/v1/auth/change-password')
          .set(auth(t))
          .send({ currentPassword: 'nope', newPassword: 'New-Passw0rd-123!', confirmPassword: 'New-Passw0rd-123!' })
      ).status,
    ).toBe(401);
    expect(
      (
        await api()
          .post('/api/v1/auth/change-password')
          .set(auth(t))
          .send({ currentPassword: PASSWORD, newPassword: 'New-Passw0rd-123!', confirmPassword: 'different' })
      ).status,
    ).toBe(400);
  });

  test('change password rejects a 1-character password', async () => {
    const t = await tokenFor(ID.oa2, 'oa');
    const res = await api()
      .post('/api/v1/auth/change-password')
      .set(auth(t))
      .send({ currentPassword: PASSWORD, newPassword: 'a', confirmPassword: 'a' });
    const accepted = res.status === 200;
    if (accepted) await db.put('users', { ...(await db.get('users', ID.oa2)), password: db.HASH });
    expect(accepted).toBe(false);
  });

  test('[FIXED SEC-10] change password ends other sessions', async () => {
    const other = await tokenFor(ID.oa2, 'oa');
    const t = await tokenFor(ID.oa2, 'oa');
    await api()
      .post('/api/v1/auth/change-password')
      .set(auth(t))
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD, confirmPassword: PASSWORD });
    expect((await api().get('/api/v1/auth/profile').set(auth(other))).status).toBe(401);
  });

  test('forgot password: same answer for known and unknown emails', async () => {
    const a = await api().post('/api/v1/auth/forgot-password').send({ email: 'faculty1@example.org' });
    const b = await api().post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.org' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body).toEqual(b.body);
  });

  async function requestResetToken(email) {
    sendEmail.mockClear();
    await api().post('/api/v1/auth/forgot-password').send({ email });
    const text = sendEmail.mock.calls[0][0].text;
    return text.match(/reset-password\/([a-f0-9]{64})/)[1];
  }

  test('reset password: token works once, then is useless; token is stored hashed', async () => {
    const token = await requestResetToken('faculty2@example.org');
    expect((await db.get('users', ID.faculty2)).resetPasswordToken).not.toBe(token);
    const r1 = await api().post(`/api/v1/auth/reset-password/${token}`).send({ password: PASSWORD });
    expect(r1.status).toBe(200);
    const r2 = await api().post(`/api/v1/auth/reset-password/${token}`).send({ password: PASSWORD });
    expect(r2.status).toBe(400);
  });

  test('reset password: expired token rejected', async () => {
    const token = await requestResetToken('faculty2@example.org');
    await db.put('users', { ...(await db.get('users', ID.faculty2)), resetPasswordExpires: Date.now() - 1000 });
    expect((await api().post(`/api/v1/auth/reset-password/${token}`).send({ password: PASSWORD })).status).toBe(400);
  });

  test('reset password rejects a 1-character password', async () => {
    const token = await requestResetToken('faculty2@example.org');
    const res = await api().post(`/api/v1/auth/reset-password/${token}`).send({ password: 'a' });
    const accepted = res.status === 200;
    if (accepted) await db.put('users', { ...(await db.get('users', ID.faculty2)), password: db.HASH });
    expect(accepted).toBe(false);
  });

  test('[FIXED SEC-10] reset password ends existing sessions', async () => {
    const attacker = await tokenFor(ID.faculty2, 'faculty');
    const token = await requestResetToken('faculty2@example.org');
    await api().post(`/api/v1/auth/reset-password/${token}`).send({ password: PASSWORD });
    expect((await api().get('/api/v1/auth/profile').set(auth(attacker))).status).toBe(401);
  });
});

describe('WhatsApp verification', () => {
  test('invalid phone format -> 400', async () => {
    const t = await tokenFor(ID.faculty1, 'faculty');
    expect((await api().post('/api/v1/auth/whatsapp/send-otp').set(auth(t)).send({ phone: '12ab' })).status).toBe(400);
  });

  test('send + verify OTP flow', async () => {
    await db.put('users', { ...(await db.get('users', ID.faculty2)), whatsappVerified: false });
    const t = await tokenFor(ID.faculty2, 'faculty');
    sendWhatsAppMessage.mockClear();
    expect((await api().post('/api/v1/auth/whatsapp/send-otp').set(auth(t)).send({ phone: '9876543210' })).status).toBe(
      200,
    );
    expect(sendWhatsAppMessage).toHaveBeenCalled();
    const otp = sendWhatsAppMessage.mock.calls[0][0].buttonParams[0];
    expect((await db.get('users', ID.faculty2)).whatsappOtp).not.toBe(otp);
    expect(
      (
        await api()
          .post('/api/v1/auth/whatsapp/verify-otp')
          .set(auth(t))
          .send({ otp: '000000' === otp ? '111111' : '000000' })
      ).status,
    ).toBe(400);
    expect((await api().post('/api/v1/auth/whatsapp/verify-otp').set(auth(t)).send({ otp })).status).toBe(200);
    expect((await db.get('users', ID.faculty2)).whatsappVerified).toBe(true);
  });

  test('WhatsApp OTP is refused after five wrong attempts', async () => {
    await db.put('users', { ...(await db.get('users', ID.faculty2)), whatsappVerified: false });
    const t = await tokenFor(ID.faculty2, 'faculty');
    await api().post('/api/v1/auth/whatsapp/send-otp').set(auth(t)).send({});
    const otp = sendWhatsAppMessage.mock.calls.at(-1)[0].buttonParams[0];
    for (let i = 0; i < 15; i++) {
      const g = String(200000 + i);
      if (g !== otp) await api().post('/api/v1/auth/whatsapp/verify-otp').set(auth(t)).send({ otp: g });
    }
    expect((await api().post('/api/v1/auth/whatsapp/verify-otp').set(auth(t)).send({ otp })).status).not.toBe(200);
  });
});

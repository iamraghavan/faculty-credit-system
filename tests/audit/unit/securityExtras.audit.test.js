/**
 * Audit (Phase 2): extra security checks that need no database.
 */
const { sendEmail } = require('../../../utils/email');
const { sendMfaEmail } = require('../../../utils/mfa');

describe('email content', () => {
  test('HTML in a user name is escaped in email content', async () => {
    sendEmail.mockClear();
    await sendMfaEmail(
      { email: 'x@example.org', name: '<a href="https://evil.example.net">Click to verify</a>' },
      '123456',
    );
    const html = sendEmail.mock.calls[0][0].html;
    expect(html).not.toContain('<a href="https://evil.example.net">');
  });
});

describe('real-time (socket.io) login check', () => {
  test.failing(
    '[BUG] socket authentication calls MongoDB-only .select() on the DynamoDB model, so every connection is rejected',
    async () => {
      jest.resetModules();
      jest.doMock('../../../Models/User', () => ({ findById: jest.fn(async () => ({ _id: 'u1', role: 'faculty' })) }));
      const jwt = require('jsonwebtoken');
      const { attachSocket } = require('../../../realtime/socketServer');
      const http = require('http');
      const server = http.createServer();
      const io = attachSocket(server, {});
      const middleware = io._nsps.get('/')._fns[0];
      const token = jwt.sign({ id: 'u1' }, process.env.JWT_SECRET);
      const err = await new Promise((resolve) => middleware({ handshake: { auth: { token } } }, resolve));
      io.close();
      expect(err).toBeUndefined(); // expected: a valid token is accepted
    },
  );

  test('socket authentication ignores session revocation and inactive accounts (code review)', () => {
    const src = require('fs').readFileSync(require.resolve('../../../realtime/socketServer'), 'utf8');
    // Documented weakness: only the JWT signature is checked; no Session / isActive check.
    expect(src).not.toMatch(/Session\.findById|isActive/);
  });
});

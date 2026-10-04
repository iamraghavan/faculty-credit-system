/**
 * Error reports must never carry tokens, cookies, request bodies or query strings (roadmap Q-8).
 */
const { scrub, enabled } = require('../../../instrument');

test('Sentry is disabled when SENTRY_DSN is not set (tests, local runs)', () => {
  expect(enabled).toBe(false);
});

test('scrub removes secrets and personal data from error reports', () => {
  const event = scrub({
    request: {
      headers: { Authorization: 'Bearer abc', cookie: 'x=y', 'x-access-token': 't', 'user-agent': 'ua' },
      data: { password: 'p', otp: '123456' },
      cookies: { session: 's' },
      query_string: 'token=abc',
    },
  });
  expect(event.request.headers.Authorization).toBe('[removed]');
  expect(event.request.headers.cookie).toBe('[removed]');
  expect(event.request.headers['x-access-token']).toBe('[removed]');
  expect(event.request.headers['user-agent']).toBe('ua');
  expect(event.request.data).toBeUndefined();
  expect(event.request.cookies).toBeUndefined();
  expect(event.request.query_string).toBe('[removed]');
});

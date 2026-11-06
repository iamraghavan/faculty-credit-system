const { isTrustedPushEndpoint } = require('../../utils/pushEndpoint');

describe('push endpoint trust boundary', () => {
  test('accepts standard push providers over HTTPS', () => {
    expect(isTrustedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isTrustedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
  });

  test('rejects local, private, and lookalike destinations', () => {
    for (const endpoint of [
      'https://127.0.0.1/private',
      'https://localhost/private',
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.evil.example/abc',
      'https://user:pass@fcm.googleapis.com/abc',
    ])
      expect(isTrustedPushEndpoint(endpoint)).toBe(false);
  });
});

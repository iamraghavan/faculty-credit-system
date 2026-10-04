/**
 * Runs inside every test file after Jest loads.
 * - Disables dotenv so the real .env file is never read.
 * - Replaces outgoing services (email, WhatsApp, GitHub, Firebase, web-push)
 *   with mocks that only record calls.
 * - Blocks all network traffic except to this computer.
 */
const nock = require('nock');

jest.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));

jest.mock('../../utils/email', () => ({
  sendEmail: jest.fn(async () => ({ sent: true, info: { messageId: 'test' } })),
  createTransporter: jest.fn(),
}));
jest.mock('../../utils/whatsapp', () => ({
  sendWhatsAppMessage: jest.fn(async () => ({ success: true })),
}));
jest.mock('../../utils/firebase', () => ({
  sendFcmNotification: jest.fn(async () => ({ success: true })),
}));
jest.mock('../../utils/githubUpload', () => {
  const url = (p) => `https://cdn.jsdelivr.net/gh/test-owner/test-repo@main/${p}`;
  return {
    uploadFileToGitHub: jest.fn(async (_local, dest) => url(dest)),
    uploadFileToGitHubBuffer: jest.fn(async (_buf, dest) => url(dest)),
    jsDelivrUrl: jest.fn((o, r, b, p) => url(p)),
  };
});
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(async () => ({ statusCode: 201 })),
  generateVAPIDKeys: jest.fn(() => ({ publicKey: 'x', privateKey: 'y' })),
}));

nock.disableNetConnect();
nock.enableNetConnect((host) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host));

afterAll(() => {
  nock.cleanAll();
});

// Keep test output readable. Set TEST_VERBOSE=1 to see application logs.
if (!process.env.TEST_VERBOSE) {
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    jest.spyOn(console, level).mockImplementation(() => {});
  }
}

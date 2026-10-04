/**
 * API-test-only setup. The global rate limiter (200 requests / 15 min / IP)
 * would block a test file that makes many requests from 127.0.0.1, so it is
 * replaced by a pass-through here. The real limiter is tested separately in
 * tests/audit/api/rateLimit.test.js (which calls jest.unmock).
 */
jest.mock('../../Middleware/rateLimitMiddleware', () => (req, res, next) => next());
jest.setTimeout(30000);

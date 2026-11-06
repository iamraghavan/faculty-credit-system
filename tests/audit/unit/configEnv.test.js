/**
 * Startup settings check (roadmap Q-6).
 */
const { checkEnvironment } = require('../../../config/env');

const good = {
  JWT_SECRET: 'x'.repeat(40),
  AWS_REGION: 'ap-south-1',
  DYNAMO_DB_USERS: 'u',
  DYNAMO_DB_CREDITS: 'c',
  DYNAMO_DB_TITLES: 't',
  DYNAMO_DB_SESSIONS: 's',
  NODE_ENV: 'production',
  CORS_ORIGIN: 'https://fcs.egspgroup.in',
  EXPORT_SIGNING_SECRET: 'y'.repeat(40),
};
const log = { warn: jest.fn() };

test('a complete, safe configuration passes with no warnings', () => {
  expect(checkEnvironment(good, log)).toEqual([]);
});

test.each([
  'JWT_SECRET',
  'AWS_REGION',
  'DYNAMO_DB_USERS',
  'DYNAMO_DB_CREDITS',
  'DYNAMO_DB_TITLES',
  'DYNAMO_DB_SESSIONS',
])('missing %s stops the server', (key) => {
  const env = { ...good };
  delete env[key];
  expect(() => checkEnvironment(env, log)).toThrow(key);
});

test('a short JWT_SECRET stops the server', () => {
  expect(() => checkEnvironment({ ...good, JWT_SECRET: 'short' }, log)).toThrow(/at least 32/);
});

test('unsafe settings only warn by default', () => {
  const warnings = checkEnvironment({ ...good, CORS_ORIGIN: '*', VERCEL: '1', NODE_ENV: 'development' }, log);
  expect(warnings).toHaveLength(2);
  expect(log.warn).toHaveBeenCalled();
});

test('STRICT_CONFIG=true refuses to start with unsafe settings', () => {
  expect(() => checkEnvironment({ ...good, CORS_ORIGIN: '*', STRICT_CONFIG: 'true' }, log)).toThrow(/STRICT_CONFIG/);
});

test('export secret equal to the login secret is flagged', () => {
  expect(checkEnvironment({ ...good, EXPORT_SIGNING_SECRET: good.JWT_SECRET }, log).join(' ')).toMatch(/different/);
});

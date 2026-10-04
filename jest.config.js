// Two test groups ("projects"):
//   unit - fast tests of single functions, no database
//   api  - real Express app + DynamoDB Local (started automatically)
// Safety: tests/setup/testEnv.js forces fake credentials and a localhost
// database, and tests/setup/afterEnv.js blocks all outgoing network traffic.
const common = {
  testEnvironment: 'node',
  clearMocks: true,
  setupFiles: ['<rootDir>/tests/setup/testEnv.js'],
  modulePathIgnorePatterns: ['<rootDir>/.dynamodb-local/'],
};

module.exports = {
  collectCoverage: false,
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'text', 'lcov', 'json-summary'],
  collectCoverageFrom: [
    'Controllers/**/*.js', 'Middleware/**/*.js', 'Models/**/*.js', 'Routes/**/*.js',
    'config/**/*.js', 'domain/**/*.js', 'utils/**/*.js', 'realtime/**/*.js', 'server.js',
  ],
  globalSetup: '<rootDir>/tests/setup/globalSetup.js',
  globalTeardown: '<rootDir>/tests/setup/globalTeardown.js',
  projects: [
    {
      ...common,
      // Pre-existing tests that no longer match the app (wrong URLs, expect hard delete).
      // Kept unchanged; run with `pnpm test:legacy`. See docs/audit/03-TEST-RESULTS.md.
      displayName: 'legacy',
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
      setupFilesAfterEnv: ['<rootDir>/tests/setup/afterEnv.js', '<rootDir>/tests/setup/afterEnvApi.js'],
    },
    {
      ...common,
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.js', '<rootDir>/tests/audit/unit/**/*.test.js'],
      setupFilesAfterEnv: ['<rootDir>/tests/setup/afterEnv.js'],
    },
    {
      ...common,
      displayName: 'api',
      testMatch: [
        '<rootDir>/tests/api/**/*.test.js',
        '<rootDir>/tests/audit/api/**/*.test.js',
      ],
      setupFilesAfterEnv: ['<rootDir>/tests/setup/afterEnv.js', '<rootDir>/tests/setup/afterEnvApi.js'],
    },
  ],
};

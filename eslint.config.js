// ESLint (roadmap Q-2). Rules that catch real bugs are errors; style issues in
// existing code are warnings so the codebase passes today and can be cleaned
// up gradually. Formatting is left to Prettier (eslint-config-prettier).
const js = require('@eslint/js');
const globals = require('globals');
const security = require('eslint-plugin-security');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: ['node_modules/', 'coverage/', '.dynamodb-local/', 'Postman/', 'swagger.json', 'middleware.js'],
  },
  js.configs.recommended,
  security.configs.recommended,
  prettier,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // Bugs: keep as errors
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-self-assign': 'error',
      'no-cond-assign': 'error',
      'require-await': 'off',
      // Existing-code clean-up: warnings for now
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-prototype-builtins': 'warn',
      'no-case-declarations': 'warn',
      'no-async-promise-executor': 'warn',
      'no-control-regex': 'warn',
      'no-useless-catch': 'warn',
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
      // eslint-plugin-security: object-injection reports are mostly false
      // positives for DynamoDB expression maps; keep the rest as warnings.
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-unsafe-regex': 'warn',
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...globals.serviceworker } },
  },
  {
    files: ['tests/**/*.js', 'jest.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
];

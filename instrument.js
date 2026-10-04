// instrument.js - error tracking with Sentry (roadmap Q-8).
// Loaded first by index.js, api/index.js and lambda.js. It does nothing
// unless SENTRY_DSN is set, so local runs and tests are unaffected.
const Sentry = require('@sentry/node');

const SENSITIVE_HEADERS = ['authorization', 'cookie', 'x-api-key', 'x-access-token'];

function scrub(event) {
  const request = event.request;
  if (request) {
    delete request.data; // request bodies can contain passwords, OTPs, personal data
    delete request.cookies;
    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        if (SENSITIVE_HEADERS.includes(name.toLowerCase())) request.headers[name] = '[removed]';
      }
    }
    if (request.query_string) request.query_string = '[removed]';
  }
  return event;
}

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    beforeSend: scrub,
    beforeSendTransaction: scrub,
  });
}

module.exports = { Sentry, enabled: Boolean(process.env.SENTRY_DSN), scrub };

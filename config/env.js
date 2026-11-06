// config/env.js
// Checks the environment when the server starts (roadmap Q-6).
//
// - Missing ESSENTIAL settings stop the server immediately with a clear
//   message (it could not work correctly or safely without them).
// - UNSAFE settings (e.g. CORS '*', NODE_ENV not 'production' on a hosted
//   deployment) are logged as warnings. Set STRICT_CONFIG=true to turn the
//   warnings into a refusal to start, once production settings are verified.
const Joi = require('joi');

const essentialSchema = Joi.object({
  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .messages({ 'string.min': 'JWT_SECRET must be at least 32 characters (use a long random value)' }),
  AWS_REGION: Joi.string().required(),
  DYNAMO_DB_USERS: Joi.string().required(),
  DYNAMO_DB_CREDITS: Joi.string().required(),
  DYNAMO_DB_TITLES: Joi.string().required(),
  DYNAMO_DB_SESSIONS: Joi.string().required(),
}).unknown(true);

function unsafeSettings(env) {
  const warnings = [];
  const hosted = Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME);
  if (hosted && env.NODE_ENV !== 'production') {
    warnings.push(
      `NODE_ENV is '${env.NODE_ENV || '(unset)'}' on a hosted deployment: error responses include stack traces. Set NODE_ENV=production.`,
    );
  }
  if (!env.CORS_ORIGIN || env.CORS_ORIGIN.trim() === '*') {
    warnings.push(
      "CORS_ORIGIN is unset or '*': any website can call this API from a browser. Set it to the exact frontend origin, e.g. https://fcs.egspgroup.in",
    );
  }
  if (!env.EXPORT_SIGNING_SECRET || Buffer.byteLength(env.EXPORT_SIGNING_SECRET) < 32) {
    warnings.push(
      'EXPORT_SIGNING_SECRET is missing or shorter than 32 bytes: signed exports and report share links will not work.',
    );
  }
  if (env.EXPORT_SIGNING_SECRET && env.EXPORT_SIGNING_SECRET === env.JWT_SECRET) {
    warnings.push('EXPORT_SIGNING_SECRET must be different from JWT_SECRET.');
  }
  return warnings;
}

/**
 * Validates process.env. Throws on missing essentials (and, with
 * STRICT_CONFIG=true, on unsafe settings). Returns the list of warnings.
 */
function checkEnvironment(env = process.env, log = console) {
  const { error } = essentialSchema.validate(env, { abortEarly: false });
  if (error) {
    const problems = error.details.map((d) => `  - ${d.message}`).join('\n');
    throw new Error(`Server cannot start: required settings are missing or invalid:\n${problems}`);
  }
  const warnings = unsafeSettings(env);
  if (warnings.length && String(env.STRICT_CONFIG).toLowerCase() === 'true') {
    throw new Error(
      `Server cannot start (STRICT_CONFIG=true): unsafe settings:\n${warnings.map((w) => `  - ${w}`).join('\n')}`,
    );
  }
  warnings.forEach((w) => log.warn(`[config] WARNING: ${w}`));
  return warnings;
}

module.exports = { checkEnvironment, unsafeSettings };

const { getSettings } = require('./applicationSettings');

async function passwordPolicyError(password) {
  const { passwordMinLength } = await getSettings();
  if (typeof password !== 'string' || password.length < passwordMinLength || password.length > 128) {
    return `Password must contain ${passwordMinLength} to 128 characters`;
  }
  return null;
}

module.exports = { passwordPolicyError };

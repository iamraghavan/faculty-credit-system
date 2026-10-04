// utils/mfaTicket.js
// Second-factor login helpers (SEC-06, SEC-07, SEC-25).
//
// - After a correct password the server issues a short-lived signed "MFA
//   ticket". The MFA step accepts only that ticket, so a user id plus a code
//   is no longer enough to log in.
// - Wrong codes are counted per account; after MFA_MAX_ATTEMPTS the pending
//   email code is cancelled and the account's MFA step is locked for
//   MFA_LOCK_MINUTES.
// - Email codes are stored as an HMAC, never in plain text.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const PURPOSE = 'mfa-login';
const TICKET_MINUTES = 5;
const MAX_ATTEMPTS = () => Math.max(3, Number(process.env.MFA_MAX_ATTEMPTS) || 5);
const LOCK_MINUTES = () => Math.max(1, Number(process.env.MFA_LOCK_MINUTES) || 15);

function issueMfaTicket(user) {
  return jwt.sign(
    { purpose: PURPOSE, uid: String(user._id || user.id), mt: user.mfaAppEnabled ? 'app' : 'email' },
    process.env.JWT_SECRET,
    { expiresIn: `${TICKET_MINUTES}m`, algorithm: 'HS256' },
  );
}

/** Returns the user id inside a valid ticket, or null. */
function readMfaTicket(ticket) {
  try {
    const payload = jwt.verify(String(ticket || ''), process.env.JWT_SECRET, { algorithms: ['HS256'] });
    return payload.purpose === PURPOSE && payload.uid ? payload.uid : null;
  } catch {
    return null;
  }
}

function hashCode(code) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(String(code)).digest('hex');
}

function codesMatch(storedHash, code) {
  if (!storedHash || !code) return false;
  const a = Buffer.from(String(storedHash));
  const b = Buffer.from(hashCode(code));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isLocked(user) {
  return !!user.mfaLockedUntil && new Date(user.mfaLockedUntil).getTime() > Date.now();
}

/** Changes to store after a wrong code (and whether the account is now locked). */
function failedAttemptChanges(user) {
  const attempts = (Number(user.mfaFailedAttempts) || 0) + 1;
  if (attempts >= MAX_ATTEMPTS()) {
    return {
      locked: true,
      changes: {
        mfaFailedAttempts: 0,
        mfaLockedUntil: new Date(Date.now() + LOCK_MINUTES() * 60000).toISOString(),
        mfaCode: null,
        mfaCodeExpires: null,
      },
    };
  }
  return { locked: false, changes: { mfaFailedAttempts: attempts } };
}

const SUCCESS_CHANGES = { mfaFailedAttempts: 0, mfaLockedUntil: null, mfaCode: null, mfaCodeExpires: null };

module.exports = {
  PURPOSE, issueMfaTicket, readMfaTicket, hashCode, codesMatch, isLocked, failedAttemptChanges, SUCCESS_CHANGES,
  LOCK_MINUTES,
};

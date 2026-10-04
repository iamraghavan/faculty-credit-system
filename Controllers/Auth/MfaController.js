const User = require('../../Models/User');
const { generateTotpSecret, generateTotpQrCode, verifyTotpToken } = require('../../utils/mfa');
const { readMfaTicket, codesMatch, isLocked, failedAttemptChanges, SUCCESS_CHANGES, LOCK_MINUTES } = require('../../utils/mfaTicket');

async function enableAppMfa(req, res, next) {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(String(userId));
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const secret = generateTotpSecret(user.email);
    const qrCodeDataURL = await generateTotpQrCode(secret);

    await User.update(user._id, {
      mfaPendingSecret: secret.base32,
      mfaPendingExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      qrCodeDataURL,
      base32Secret: secret.base32,
    });
  } catch (err) {
    next(err);
  }
}

async function verifyAppMfaSetup(req, res, next) {
  try {
    const token = String(req.body?.token || '').trim();
    if (!/^\d{6}$/.test(token)) return res.status(400).json({ success: false, message: 'A 6-digit authenticator code is required' });
    const userId = String(req.user._id || req.user.id);
    const user = await User.findById(userId);
    const expired = !user?.mfaPendingExpiresAt || new Date(user.mfaPendingExpiresAt).getTime() <= Date.now();
    if (!user?.mfaPendingSecret || expired) {
      return res.status(400).json({ success: false, message: 'MFA setup expired. Start setup again.' });
    }
    if (!verifyTotpToken(user.mfaPendingSecret, token)) {
      return res.status(400).json({ success: false, message: 'Invalid authenticator code' });
    }
    await User.update(userId, {
      mfaEnabled: true,
      mfaAppEnabled: true,
      mfaEmailEnabled: false,
      mfaSecret: user.mfaPendingSecret,
      mfaPendingSecret: null,
      mfaPendingExpiresAt: null,
      updatedAt: new Date().toISOString(),
    });
    return res.json({ success: true, message: 'Authenticator MFA enabled successfully' });
  } catch (err) {
    next(err);
  }
}

/**
 * Second login step: POST /api/v1/auth/verify-mfa  { mfaTicket, code }
 * The ticket is issued by /auth/login only after a correct password, so the
 * code alone is never enough (SEC-06). Wrong codes are limited (SEC-07).
 */
async function verifyMfaLogin(req, res, next) {
  try {
    // Lazy require avoids a circular import with AuthenticationController.
    const { completeLogin } = require('./AuthenticationController');
    const { mfaTicket, type } = req.body || {};
    const code = String(req.body?.code || req.body?.token || '').trim();

    const userId = readMfaTicket(mfaTicket);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Your sign-in step expired. Please enter your password again.' });
    }
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ success: false, message: 'A 6-digit code is required' });

    const user = await User.findById(userId);
    if (!user || user.isActive === false) return res.status(401).json({ success: false, message: 'Your sign-in step expired. Please enter your password again.' });
    if (!user.mfaEmailEnabled && !user.mfaAppEnabled) return res.status(400).json({ success: false, message: 'MFA not enabled for this user' });
    if (isLocked(user)) {
      return res.status(429).json({ success: false, message: `Too many wrong verification codes. Try again in ${LOCK_MINUTES()} minutes.` });
    }

    let verified = false;
    if (user.mfaAppEnabled && (!type || type === 'app')) {
      verified = verifyTotpToken(user.mfaSecret, code);
    }
    if (!verified && user.mfaEmailEnabled && (!type || type === 'email')) {
      verified = !!user.mfaCodeExpires && Date.now() <= Number(user.mfaCodeExpires) && codesMatch(user.mfaCode, code);
    }

    if (!verified) {
      const { locked, changes } = failedAttemptChanges(user);
      await User.update(String(user._id), changes);
      return res.status(locked ? 429 : 400).json({
        success: false,
        message: locked ? `Too many wrong verification codes. Try again in ${LOCK_MINUTES()} minutes.` : 'Invalid or expired MFA code',
      });
    }

    await User.update(String(user._id), SUCCESS_CHANGES); // also makes an email code single-use
    return res.json({ ...(await completeLogin(user, req)), message: 'MFA verified successfully' });
  } catch (err) {
    next(err);
  }
}

module.exports = { enableAppMfa, verifyAppMfaSetup, verifyMfaLogin };

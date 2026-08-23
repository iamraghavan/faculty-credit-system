const User = require('../../Models/User');
const { generateTotpSecret, generateTotpQrCode, verifyTotpToken } = require('../../utils/mfa');

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

// ... other MFA methods ...

module.exports = { enableAppMfa, verifyAppMfaSetup };

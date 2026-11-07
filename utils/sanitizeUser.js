const PRIVATE_FIELDS = new Set([
  'password',
  'apiKey',
  'mfaSecret',
  'mfaPendingSecret',
  'mfaPendingExpiresAt',
  'mfaPendingEmailCode',
  'mfaPendingEmailExpiresAt',
  'mfaPendingAttempts',
  'mfaCode',
  'mfaCodeExpires',
  'whatsappOtp',
  'whatsappOtpExpires',
  'whatsappOtpAttempts',
  'resetPasswordToken',
  'resetPasswordExpires',
  'fcmToken',
  'fcmDevices',
  'passwordResetToken',
  'passwordResetExpires',
]);

function sanitizeUser(user) {
  return Object.fromEntries(Object.entries(user || {}).filter(([field]) => !PRIVATE_FIELDS.has(field)));
}

module.exports = { sanitizeUser };

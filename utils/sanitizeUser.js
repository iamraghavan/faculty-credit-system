const PRIVATE_FIELDS = new Set([
  'password', 'apiKey', 'mfaSecret', 'mfaCode', 'mfaCodeExpires',
  'whatsappOtp', 'whatsappOtpExpires', 'resetPasswordToken', 'resetPasswordExpires',
  'fcmToken', 'passwordResetToken', 'passwordResetExpires',
]);

function sanitizeUser(user) {
  return Object.fromEntries(Object.entries(user || {}).filter(([field]) => !PRIVATE_FIELDS.has(field)));
}

module.exports = { sanitizeUser };

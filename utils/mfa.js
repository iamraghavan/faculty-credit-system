// utils/mfa.js
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { sendEmail } = require('./email');

function generateMfaCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

async function sendMfaEmail(user, code, purpose = 'login') {
  const isSetup = purpose === 'setup';
  const safeName = String(user.name || 'User').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
  const mailOptions = {
    to: user.email,
    subject: isSetup ? 'CreditWise - Confirm email authentication' : 'CreditWise - Your MFA Verification Code',
    text: `Hello ${user.name},\n\nYour ${isSetup ? 'email authentication setup' : 'login'} verification code is: ${code}\nIt expires in 5 minutes.`,
    html: `<p>Hello ${safeName},</p>
           <p>Your ${isSetup ? 'email authentication setup' : 'login'} verification code is:</p>
           <h2>${code}</h2>
           <p>This code expires in 5 minutes.</p>`,
  };
  await sendEmail(mailOptions);
}

function generateTotpSecret(userEmail) {
  const secret = speakeasy.generateSecret({
    name: `CreditWise (${userEmail})`,
    length: 20,
  });
  return secret;
}

async function generateTotpQrCode(secret) {
  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);
  return qrDataUrl;
}

function verifyTotpToken(secretBase32, token) {
  return speakeasy.totp.verify({
    secret: secretBase32,
    encoding: 'base32',
    token,
    window: 1, // allows small clock drift
  });
}

module.exports = {
  generateMfaCode,
  sendMfaEmail,
  generateTotpSecret,
  generateTotpQrCode,
  verifyTotpToken,
};

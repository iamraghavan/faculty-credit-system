// utils/mfa.js
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { sendEmail } = require('./email');

function generateMfaCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit numeric
}

async function sendMfaEmail(user, code) {
  const mailOptions = {
    to: user.email,
    subject: 'CreditWise - Your MFA Verification Code',
    text: `Hello ${user.name},\n\nYour login verification code is: ${code}\nIt expires in 5 minutes.`,
    html: `<p>Hello ${user.name},</p>
           <p>Your login verification code is:</p>
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

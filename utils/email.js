// utils/email.js
const nodemailer = require('nodemailer');

const {
  EMAIL_HOST,
  EMAIL_PORT,
  EMAIL_USER,
  EMAIL_PASS: RAW_EMAIL_PASS,
  EMAIL_SECURE = 'auto', // 'true' | 'false' | 'auto'
  EMAIL_DEBUG = 'false', // set to 'true' to enable nodemailer debug & logger
} = process.env;

/**
 * Sanitize password: remove accidental surrounding quotes and trim whitespace.
 * If your password truly contains spaces or quotes, ensure you set the env value exactly.
 */
const EMAIL_PASS =
  RAW_EMAIL_PASS && typeof RAW_EMAIL_PASS === 'string'
    ? RAW_EMAIL_PASS.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
    : RAW_EMAIL_PASS;

if (!EMAIL_HOST || !EMAIL_PORT || !EMAIL_USER || !EMAIL_PASS) {
  console.warn('Email env not fully configured. Ensure EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS are set.');
}

/**
 * Build nodemailer transporter with sensible defaults for Gmail/SMTP use.
 */
function createTransporter() {
  if (!EMAIL_HOST || !EMAIL_PORT || !EMAIL_USER || !EMAIL_PASS) {
    throw new Error('Email settings are not properly configured. Ensure EMAIL_HOST, EMAIL_PORT, EMAIL_USER and EMAIL_PASS are set.');
  }

  const port = Number(EMAIL_PORT);
  const secure =
    String(EMAIL_SECURE).toLowerCase() === 'true' ? true
      : String(EMAIL_SECURE).toLowerCase() === 'false' ? false
        : (port === 465); // auto: 465 => secure:true, otherwise false (STARTTLS)

  const opts = {
    host: EMAIL_HOST,
    port,
    secure,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    logger: String(EMAIL_DEBUG).toLowerCase() === 'true',
    debug: String(EMAIL_DEBUG).toLowerCase() === 'true',
    tls: {
      rejectUnauthorized: true, // keep strict in prod
    },
  };

  // For port 587 (STARTTLS), ensure secure=false and require TLS
  if (port === 587) {
    opts.requireTLS = true;
    opts.secure = false;
  }

  return nodemailer.createTransport(opts);
}

/**
 * Send email with retries on transient errors.
 * Returns { sent: true, info } on success.
 * Throws if verify or send fails (no fallback).
 *
 * options: { to, subject, text, html }
 * retries: number of retry attempts for transient send errors (default 2)
 *
 * IMPORTANT: For Gmail / Google Workspace, use an App Password (if account has 2FA) and put it in EMAIL_PASS.
 */
async function sendEmail({ to, subject, text, html, attachments }, retries = 2) {
  const transporter = createTransporter();

  // Verify transporter first — helpful to catch auth/whitelisting/TLS issues early.
  try {
    await transporter.verify();
  } catch (verifyErr) {
    // Log detailed info to help debug (do NOT expose in client responses)
    console.error('Email transporter verification failed:', {
      message: verifyErr && verifyErr.message,
      code: verifyErr && verifyErr.code,
      response: verifyErr && verifyErr.response,
      responseCode: verifyErr && verifyErr.responseCode,
      stack: verifyErr && verifyErr.stack,
    });
    throw new Error(`Failed to verify email transporter: ${verifyErr && verifyErr.message ? verifyErr.message : 'unknown error'}`);
  }

  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    attempt++;
    try {
      const info = await transporter.sendMail({
        from: `"Faculty Credit System" <${EMAIL_USER}>`,
        to,
        subject,
        text,
        html,
        attachments,
      });
      console.log(`Email sent to ${to} (attempt ${attempt})`, info && info.messageId ? `messageId=${info.messageId}` : '');
      return { sent: true, info };
    } catch (sendErr) {
      lastError = sendErr;
      const code = sendErr && sendErr.code;
      const isTransient = ['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ENOTFOUND', 'ESOCKET'].includes(code) || /timeout|ENOTFOUND|ECONNRESET/i.test(sendErr.message || '');

      console.warn(`Email send attempt ${attempt} failed:`, { message: sendErr && sendErr.message, code });

      if (!isTransient || attempt > retries) {
        console.error('Email send failed permanently:', { message: sendErr && sendErr.message, code, stack: sendErr && sendErr.stack });
        throw sendErr;
      }

      // Exponential backoff before retry
      const delay = 1000 * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
      // continue retry loop
    }
  }

  // If we exit loop without success
  throw lastError || new Error('Unknown error sending email');
}

module.exports = { sendEmail, createTransporter };

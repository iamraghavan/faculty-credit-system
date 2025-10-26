// utils/email.js
const nodemailer = require('nodemailer');

const {
  EMAIL_HOST,
  EMAIL_PORT,
  EMAIL_USER,
  EMAIL_PASS,
  EMAIL_SECURE = 'false', // 'true' for 465, 'false' for 587
} = process.env;

// Create transporter factory
function createTransporter() {
  if (!EMAIL_USER || !EMAIL_PASS || !EMAIL_HOST || !EMAIL_PORT) {
    throw new Error('Email settings are not properly configured.');
  }

  return nodemailer.createTransport({
    host: EMAIL_HOST,
    port: Number(EMAIL_PORT),
    secure: EMAIL_SECURE === 'true',
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
    connectionTimeout: 10000, // 10 sec to establish TCP
    greetingTimeout: 10000,   // wait max 10s for SMTP greeting
    socketTimeout: 30000,     // max socket idle 30s
    pool: true,               // use connection pooling for multiple sends
    maxConnections: 5,
    maxMessages: 100,
  });
}

/**
 * Send email with retry on transient errors.
 * @param {Object} options - { to, subject, text, html }
 * @param {number} retries - number of retry attempts (default 2)
 */
async function sendEmail({ to, subject, text, html }, retries = 2) {
  const transporter = createTransporter();

  // Verify transporter before sending
  try {
    await transporter.verify();
  } catch (err) {
    console.error('Email transporter verification failed:', err.message);
    throw new Error('Failed to verify email transporter');
  }

  let attempt = 0;
  let lastError;

  while (attempt <= retries) {
    attempt++;
    try {
      const info = await transporter.sendMail({
        from: `"Faculty Credit System" <${EMAIL_USER}>`,
        to,
        subject,
        text,
        html,
      });
      console.log(`Email sent successfully to ${to} (attempt ${attempt})`);
      return info;
    } catch (err) {
      lastError = err;
      const isTransient = ['ETIMEDOUT', 'ECONNRESET', 'EPIPE'].includes(err.code);
      console.warn(`Email send attempt ${attempt} failed: ${err.code || err.message}`);

      if (!isTransient || attempt > retries) {
        console.error('Email send failed permanently:', err);
        throw err;
      }

      // exponential backoff before retry
      const delay = 1000 * Math.pow(2, attempt - 1);
      console.log(`Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastError;
}

module.exports = { sendEmail };

// Controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../Models/User');
const { generateFacultyID, generateApiKey } = require('../utils/generateID');
const { recalcFacultyCredits } = require('../utils/calculateCredits');
const multer = require('multer');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../utils/email'); // your existing email util
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const { generateTotpSecret, generateTotpQrCode, verifyTotpToken, generateMfaCode, sendMfaEmail } = require('../utils/mfa');
/**
 * Register a new user (DynamoDB version)
 */
async function register(req, res, next) {
  try {
    const { name, email, password, college, department, role } = req.body;
    if (!name || !email || !password || !college) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // Duplicate email check
    const existingUsers = await User.find({ email: normalizedEmail });
    if (existingUsers && existingUsers.length > 0) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    // Role assignment logic
    let assignedRole = 'faculty'; // default for self-registration

    const allUsers = await User.find();
    if (!allUsers || allUsers.length === 0) {
      // First user: allow admin, oa, or faculty
      if (['admin', 'oa'].includes(role)) assignedRole = role;
      else assignedRole = 'faculty';
    } else {
      // There are existing users
      if (req.user && req.user.role === 'admin') {
        // Admin can create any role
        if (['admin', 'oa', 'faculty'].includes(role)) assignedRole = role;
        else assignedRole = 'faculty';
      } else {
        // Non-admins (self-registration)
        assignedRole = 'faculty';
      }
    }

    // Hash password
    const hashed = await bcrypt.hash(password, 10);

    // Generate IDs and keys
    const facultyID = generateFacultyID(college);
    const apiKey = generateApiKey();

    const newUserPayload = {
      name,
      email: normalizedEmail,
      password: hashed,
      college,
      department,
      facultyID,
      apiKey,
      role: assignedRole,
      currentCredit: 0,
      creditsByYear: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const newUser = await User.create(newUserPayload);

    const userIdForToken = newUser._id || newUser.id || newUser.pk || newUser.userId;
    const token = jwt.sign(
      { id: userIdForToken, role: assignedRole },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );

    return res.status(201).json({
      success: true,
      data: {
        id: userIdForToken,
        name: newUser.name,
        facultyID: newUser.facultyID,
        apiKey: newUser.apiKey,
        role: newUser.role,
        department: newUser.department,
        token,
      },
    });
  } catch (err) {
    next(err);
  }
}


/**
 * Login with email & password (DynamoDB version)
 */
async function login(req, res, next) {
  try {
    const { email, password, mfaToken, token, turnstileToken } = req.body;

    // Support both mfaToken and token (if 6-digit) for backwards compatibility
    const actualMfaToken = mfaToken || (token && String(token).length === 6 ? token : null);

    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Missing credentials' });

    const users = await User.find({ email: email.toLowerCase() });
    if (users.length === 0)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const user = users[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const freshUser = await User.findById(user._id);

    // 🔸 If MFA is NOT enabled — issue token directly
    if (!user.mfaEnabled) {
      const jwtToken = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '1h',
      });

      return res.json({
        success: true,
        mfaRequired: false,
        data: {
          id: freshUser._id,
          name: freshUser.name,
          facultyID: freshUser.facultyID,
          apiKey: freshUser.apiKey,
          role: freshUser.role,
          department: freshUser.department,
          currentCredit: freshUser.currentCredit,
          creditsByYear: freshUser.creditsByYear,
          token: jwtToken,
        },
      });
    }

    // 🔸 If App-based MFA is enabled AND a 6-digit actualMfaToken is provided
    if (actualMfaToken && String(actualMfaToken).length === 6 && user.mfaAppEnabled) {
      const valid = verifyTotpToken(user.mfaSecret, actualMfaToken);
      if (!valid)
        return res.status(400).json({ success: false, message: 'Invalid MFA code' });

      const jwtToken = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '1h',
      });

      return res.json({
        success: true,
        mfaRequired: false,
        message: 'MFA verified (App)',
        data: {
          id: freshUser._id,
          name: freshUser.name,
          facultyID: freshUser.facultyID,
          apiKey: freshUser.apiKey,
          role: freshUser.role,
          department: freshUser.department,
          currentCredit: freshUser.currentCredit,
          creditsByYear: freshUser.creditsByYear,
          token: jwtToken,
        },
      });
    }
    const valid = verifyTotpToken(user.mfaSecret, mfaToken);
    if (!valid)
      return res.status(400).json({ success: false, message: 'Invalid MFA code' });

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    });

    return res.json({
      success: true,
      mfaRequired: false,
      message: 'MFA verified (App)',
      data: {
        id: freshUser._id,
        name: freshUser.name,
        facultyID: freshUser.facultyID,
        apiKey: freshUser.apiKey,
        role: freshUser.role,
        department: freshUser.department,
        currentCredit: freshUser.currentCredit,
        creditsByYear: freshUser.creditsByYear,
        token,
      },
    });
  }

    // 🔸 If Email-based MFA enabled (send code)
    if (user.mfaEmailEnabled) {
    const code = generateMfaCode();
    const expires = Date.now() + 5 * 60 * 1000;
    await User.update(user._id, { mfaCode: code, mfaCodeExpires: expires });
    await sendMfaEmail(user, code);

    return res.json({
      success: true,
      mfaRequired: true,
      mfaType: 'email',
      userId: user._id,
      message: 'Email MFA code sent. Please verify with /verify-mfa endpoint.',
      data: {
        id: freshUser._id,
        name: freshUser.name,
        facultyID: freshUser.facultyID,
        apiKey: freshUser.apiKey,
        role: freshUser.role,
        department: freshUser.department,
        currentCredit: freshUser.currentCredit,
        creditsByYear: freshUser.creditsByYear,
      },
    });
  }

  // 🔸 If only App-based MFA is on but no 6-digit mfaToken sent yet
  if (user.mfaAppEnabled && (!mfaToken || String(mfaToken).length !== 6)) {
    return res.json({
      success: true,
      mfaRequired: true,
      mfaType: 'app',
      message: 'App-based MFA required. Please provide code from your authenticator app.',
      data: {
        id: freshUser._id,
        name: freshUser.name,
        facultyID: freshUser.facultyID,
        apiKey: freshUser.apiKey,
        role: freshUser.role,
        department: freshUser.department,
        currentCredit: freshUser.currentCredit,
        creditsByYear: freshUser.creditsByYear,
      },
    });
  }

} catch (err) {
  next(err);
}
}


/**
 * Refresh token
 */
async function refreshToken(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const token = jwt.sign(
      { id: req.user._id, role: req.user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );
    res.json({ success: true, token });
  } catch (err) {
    next(err);
  }
}

// Simple in-process email queue (no Redis)
function createEmailQueue({ concurrency = 5, maxRetries = 3, baseDelayMs = 1000 } = {}) {
  const queue = [];
  let active = 0;

  async function worker(task) {
    let attempt = 0;
    while (attempt <= maxRetries) {
      attempt++;
      try {
        // sendEmail returns {sent: true, info} on success or throws on error
        await sendEmail(task.mailOptions, 0); // pass 0 to avoid nested retries in worker
        return { success: true, attempts: attempt };
      } catch (err) {
        const isLast = attempt > maxRetries;
        if (isLast) {
          return { success: false, attempts: attempt, error: err.message || String(err) };
        }
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    return { success: false, error: 'Unknown worker error' };
  }

  function processNext() {
    if (active >= concurrency || queue.length === 0) return;
    const { task, resolve } = queue.shift();
    active++;
    worker(task)
      .then((res) => {
        active--;
        resolve(res);
        processNext();
      })
      .catch((err) => {
        active--;
        resolve({ success: false, error: err.message || String(err) });
        processNext();
      });
    // try to start more workers
    processNext();
  }

  return {
    enqueue(task) {
      return new Promise((resolve) => {
        queue.push({ task, resolve });
        processNext();
      });
    },
    async drain() {
      while (queue.length > 0 || active > 0) {
        await new Promise((r) => setTimeout(r, 250));
      }
    },
  };
}

/**
 * Bulk register users from uploaded Excel/CSV file
 * Route usage: router.post('/users/bulk-upload', authMiddleware, adminOnly, upload.single('file'), bulkRegister)
 *
 * Query params:
 *  - sendEmails (default true) => if false, skip sending emails
 *  - waitForEmailQueue (default false) => if true, API waits for queue drain (not recommended for large files)
 */
async function bulkRegister(req, res, next) {
  try {
    // multer should have populated req.file via upload.single('file')
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded. Provide file as form-data key "file".' });
    }

    // Resolve template path (default fallback)
    const templatePath = process.env.BULK_USER_EMAIL_TEMPLATE
      ? path.resolve(process.env.BULK_USER_EMAIL_TEMPLATE)
      : path.resolve(process.cwd(), 'email-templates', 'bulk-user.html');

    let emailTemplateHtml = null;
    try {
      emailTemplateHtml = await fs.readFile(templatePath, 'utf8');
    } catch (err) {
      console.warn(`Bulk email template not found at ${templatePath}. Falling back to simple HTML/text.`);
      emailTemplateHtml = null;
    }

    // Parse workbook
    const buffer = req.file.buffer;
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null });

    if (!rows || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'File contains no rows.' });
    }

    const ALLOWED_ROLES = ['admin', 'oa', 'faculty'];

    // load existing users to check duplicates
    const allUsers = await User.find();
    const existingEmails = new Set((allUsers || []).map((u) => String(u.email).toLowerCase()));

    // Email queue
    const sendEmailsFlag = !(String(req.query.sendEmails || 'true').toLowerCase() === 'false');
    const emailQueue = createEmailQueue({ concurrency: Number(process.env.BULK_EMAIL_CONCURRENCY) || 5, maxRetries: 3 });

    const results = [];

    // first-user tracking
    let dbInitiallyEmpty = !allUsers || allUsers.length === 0;
    let createdCountInThisBatch = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2; // header considered row 1
      try {
        // Map expected columns (case-insensitive)
        const name = r['name'] ?? r['Name'] ?? r['fullName'] ?? r['Full Name'] ?? null;
        const emailRaw = r['email'] ?? r['Email'] ?? null;
        const passwordRaw = r['password'] ?? r['Password'] ?? null;
        const college = r['college'] ?? r['College'] ?? null;
        const department = r['department'] ?? r['Department'] ?? '';
        const roleRaw = r['role'] ?? r['Role'] ?? null;
        const prefix = r['prefix'] ?? r['Prefix'] ?? 'Mr.';
        const isActiveRaw = r['isActive'] ?? r['is_active'] ?? r['IsActive'] ?? true;

        if (!name || !emailRaw || !college) {
          results.push({ row: rowNum, success: false, message: 'Missing required fields (name, email, college are required).' });
          continue;
        }

        if (!passwordRaw) {
          results.push({ row: rowNum, success: false, message: 'Password column is required for each row in this upload.' });
          continue;
        }

        const email = String(emailRaw).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          results.push({ row: rowNum, success: false, message: 'Invalid email format.' });
          continue;
        }

        if (existingEmails.has(email)) {
          results.push({ row: rowNum, success: false, message: `Email already exists: ${email}` });
          continue;
        }

        // role assignment logic
        let assignedRole = 'faculty';
        if (dbInitiallyEmpty && createdCountInThisBatch === 0) {
          if (roleRaw && ['admin', 'oa'].includes(String(roleRaw).toLowerCase())) {
            assignedRole = String(roleRaw).toLowerCase();
          } else {
            assignedRole = 'faculty';
          }
        } else {
          if (req.user && req.user.role === 'admin') {
            if (roleRaw && ALLOWED_ROLES.includes(String(roleRaw).toLowerCase())) {
              assignedRole = String(roleRaw).toLowerCase();
            } else {
              assignedRole = 'faculty';
            }
          } else {
            assignedRole = 'faculty';
          }
        }

        // plaintext password from sheet (for email only)
        const plaintextPassword = String(passwordRaw);

        // hash password before storing
        const hashed = await bcrypt.hash(plaintextPassword, 10);

        // generate ids
        const facultyID = generateFacultyID(college);
        const apiKey = generateApiKey();

        const newUserPayload = {
          name,
          email,
          password: hashed,
          college,
          department: department || '',
          facultyID,
          apiKey,
          role: assignedRole,
          prefix: prefix || 'Mr.',
          isActive: (typeof isActiveRaw === 'boolean') ? isActiveRaw : String(isActiveRaw).toLowerCase() !== 'false',
          currentCredit: 0,
          creditsByYear: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // create user
        const created = await User.create(newUserPayload);

        // mark email used
        existingEmails.add(email);
        createdCountInThisBatch++;
        dbInitiallyEmpty = false;

        // prepare result container
        const resultItem = {
          row: rowNum,
          success: true,
          id: created._id || created.id || created.pk || null,
          email,
          role: created.role,
          emailQueued: false,
          emailSent: false,
          emailError: null,
        };

        // send or queue email if enabled
        if (sendEmailsFlag) {
          const loginUrl = process.env.LOGIN_URL || `${req.protocol}://${req.get('host')}/login`;
          // Build HTML (from template or fallback)
          let html = null;
          let text = null;

          if (emailTemplateHtml) {
            html = emailTemplateHtml
              .replace(/{{\s*name\s*}}/gi, created.name || '')
              .replace(/{{\s*email\s*}}/gi, created.email || '')
              .replace(/{{\s*password\s*}}/gi, plaintextPassword)
              .replace(/{{\s*loginUrl\s*}}/gi, loginUrl)
              .replace(/{{\s*facultyID\s*}}/gi, facultyID || '')
              .replace(/{{\s*college\s*}}/gi, created.college || '');

            // simple text fallback
            text = `Hello ${created.name},\n\nYour account has been created.\nEmail: ${created.email}\nPassword: ${plaintextPassword}\nLogin: ${loginUrl}\n\nPlease change your password after first login.`;
          } else {
            html = `<p>Hello ${created.name},</p>
<p>Your account has been created.</p>
<ul>
  <li><strong>Email:</strong> ${created.email}</li>
  <li><strong>Password:</strong> ${plaintextPassword}</li>
  <li><strong>Faculty ID:</strong> ${facultyID}</li>
  <li><strong>College:</strong> ${created.college}</li>
</ul>
<p>Login here: <a href="${loginUrl}">${loginUrl}</a></p>
<p>Please change your password after first login.</p>`;
            text = `Hello ${created.name},\n\nYour account has been created.\nEmail: ${created.email}\nPassword: ${plaintextPassword}\nFaculty ID: ${facultyID}\nLogin: ${loginUrl}\n\nPlease change your password after first login.`;
          }

          const mailOptions = {
            to: created.email,
            subject: process.env.BULK_USER_EMAIL_SUBJECT || 'EGSPGOI - CreditWise - Your account has been created',
            text,
            html,
          };

          // enqueue and await result from queue
          try {
            resultItem.emailQueued = true;
            const emailResult = await emailQueue.enqueue({ mailOptions });
            if (emailResult.success) {
              resultItem.emailSent = true;
            } else {
              resultItem.emailSent = false;
              resultItem.emailError = emailResult.error || `Failed after ${emailResult.attempts || 'N'} attempts`;
            }
          } catch (errEmail) {
            resultItem.emailSent = false;
            resultItem.emailError = errEmail.message || String(errEmail);
          }
        }

        results.push(resultItem);
      } catch (errRow) {
        results.push({ row: rowNum, success: false, message: errRow.message || String(errRow) || 'Unknown error' });
      }
    } // end for rows

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    // Optionally wait for queue to drain before returning (careful with large uploads)
    const waitForQueue = String(req.query.waitForEmailQueue || 'false').toLowerCase() === 'true';
    if (waitForQueue && sendEmailsFlag) {
      await emailQueue.drain();
    }

    return res.status(200).json({
      success: true,
      summary: { total: results.length, success: successCount, failed: failureCount },
      results,
    });
  } catch (err) {
    next(err);
  }
}



/**
 * Forgot Password
 * Sends an email with a reset link to the user if the email exists.
 */
async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    if (!email)
      return res.status(400).json({ success: false, message: 'Email is required' });

    const users = await User.find({ email: email.toLowerCase() });
    if (!users || users.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'If that email exists, a reset link was sent.',
      }); // avoid leaking user existence
    }

    const user = users[0];

    // Create reset token (short-lived)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetExpires = Date.now() + 1000 * 60 * 10; // 10 minutes

    // Save token & expiry in user record
    await User.update(user._id, {
      resetPasswordToken: hashedToken,
      resetPasswordExpires: resetExpires,
    });

    const resetUrl = `${process.env.FRONTEND_URL || 'https://fcs.egspgroup.in/u/portal/auth'}/reset-password/${resetToken}`;

    const mailOptions = {
      to: user.email,
      subject: 'Password Reset - CreditWise - EGSPGOI',
      text: `Hello ${user.name},

We received a request to reset your password for the CreditWise.

Click the link below to reset your password:
${resetUrl}

This link will expire in 10 minutes.

If you did not request a password reset, please ignore this email or contact your system administrator.`,

      html: `
  <div style="font-family: Arial, sans-serif; background-color: #f5f7fa; padding: 40px 0;">
    <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05);">
      <div style="background: #0c3c78; color: #ffffff; padding: 20px 30px; text-align: center;">
        <h2 style="margin: 0; font-size: 20px;">CreditWise - EGSPGOI</h2>
      </div>

      <div style="padding: 30px;">
        <p style="font-size: 16px; color: #333;">Hello <strong>${user.name}</strong>,</p>

        <p style="font-size: 15px; color: #444; line-height: 1.6;">
          We received a request to reset your password for your CreditWise account.
          To proceed, please click the button below:
        </p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" target="_blank"
            style="background-color: #0c3c78; color: #ffffff; text-decoration: none; 
                   padding: 12px 24px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Reset Password
          </a>
        </div>

        <p style="font-size: 14px; color: #555; line-height: 1.6;">
          Or, if the button above doesn’t work, copy and paste the following link into your browser:
        </p>

        <p style="word-break: break-all; color: #0c3c78; font-size: 13px; margin-top: 10px;">
          <a href="${resetUrl}" target="_blank" style="color: #0c3c78;">${resetUrl}</a>
        </p>

        <p style="font-size: 14px; color: #555; margin-top: 25px;">
          This link will expire in <strong>10 minutes</strong> for your security.
          If you didn’t request this change, you can safely ignore this email or contact your system administrator.
        </p>
      </div>

      <div style="background: #f0f3f8; padding: 15px 30px; text-align: center; font-size: 12px; color: #888;">
        <p style="margin: 0;">&copy; ${new Date().getFullYear()} CreditWise | EGSPGOI</p>
      </div>
    </div>
  </div>
  `,
    };


    await sendEmail(mailOptions);

    return res.status(200).json({
      success: true,
      message: 'Password reset email sent (if email exists)',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Reset Password
 * Verifies the token and updates the password.
 */
async function resetPassword(req, res, next) {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!token || !password)
      return res.status(400).json({ success: false, message: 'Token and new password required' });

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Scan all users and find matching token (DynamoDB doesn’t support direct secondary key lookups easily)
    const users = await User.find();
    const user = users.find(
      (u) =>
        u.resetPasswordToken === hashedToken &&
        u.resetPasswordExpires &&
        Date.now() < Number(u.resetPasswordExpires)
    );

    if (!user)
      return res.status(400).json({ success: false, message: 'Invalid or expired token' });

    const hashed = await bcrypt.hash(password, 10);

    await User.update(user._id, {
      password: hashed,
      resetPasswordToken: null,
      resetPasswordExpires: null,
      updatedAt: new Date().toISOString(),
    });

    const mailOptions = {
      to: user.email,
      subject: 'CreditWise - Your password has been changed',
      text: `Hello ${user.name},\n\nYour password has been successfully reset.\nIf you did not perform this action, please contact support immediately.`,
      html: `<p>Hello ${user.name},</p>
<p>Your password has been successfully reset.</p>
<p>If you did not perform this action, please contact support immediately.</p>`,
    };

    await sendEmail(mailOptions);

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully',
    });
  } catch (err) {
    next(err);
  }
}
async function enableAppMfa(req, res, next) {
  try {
    // Try both possible user ID fields from JWT / auth middleware
    const userId = req.user._id || req.user.id;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID not provided' });
    }

    // Ensure it's a string
    const dynamoId = String(userId);

    // Fetch user by DynamoDB _id
    const user = await User.findById(dynamoId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Generate TOTP secret
    const secret = generateTotpSecret(user.email);

    // Generate QR Code
    const qrCodeDataURL = await generateTotpQrCode(secret);

    // Save secret temporarily (not fully enabled until verified)
    await User.update(user._id, {
      mfaAppEnabled: true,
      mfaSecret: secret.base32,
      mfaEnabled: true,
      updatedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: 'Scan this QR code in your Authenticator app.',
      qrCodeDataURL,
      base32Secret: secret.base32,
    });
  } catch (err) {
    console.error('enableAppMfa error:', err);
    next(err);
  }
}

async function verifyAppMfaSetup(req, res, next) {
  try {
    const { token } = req.body;
    const userId = String(req.user._id || req.user.id);

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.mfaSecret) {
      return res.status(400).json({ success: false, message: 'MFA secret not found' });
    }

    const valid = verifyTotpToken(user.mfaSecret, token);
    if (!valid) {
      return res.status(400).json({ success: false, message: 'Invalid or expired TOTP code' });
    }

    await User.update(user._id, { mfaAppEnabled: true, mfaEnabled: true });

    res.json({ success: true, message: 'App-based MFA successfully verified and enabled' });
  } catch (err) {
    next(err);
  }
}

async function toggleEmailMfa(req, res, next) {
  try {
    const { enable } = req.body;
    const userId = String(req.user._id || req.user.id);

    await User.update(userId, {
      mfaEmailEnabled: !!enable,
      mfaEnabled: !!enable, // if disabling both, handle separately
    });

    res.json({ success: true, message: `Email-based MFA ${enable ? 'enabled' : 'disabled'}` });
  } catch (err) {
    next(err);
  }
}

async function disableAllMfa(req, res, next) {
  try {
    const userId = String(req.user._id || req.user.id);

    await User.update(userId, {
      mfaEnabled: false,
      mfaEmailEnabled: false,
      mfaAppEnabled: false,
      mfaSecret: null,
      mfaCode: null,
      mfaCodeExpires: null,
    });

    res.json({ success: true, message: 'All MFA disabled' });
  } catch (err) {
    next(err);
  }
}
async function verifyMfa(req, res, next) {
  try {
    const { userId: bodyUserId, code: bodyCode, token: bodyToken } = req.body;
    const code = bodyCode || bodyToken; // accept either
    const userId = bodyUserId || (req.user ? (req.user._id || req.user.id) : null);

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required for verification' });
    }

    if (!code) {
      return res.status(400).json({ success: false, message: 'MFA code is required' });
    }

    const user = await User.findById(userId);
    if (!user || !user.mfaEmailEnabled)
      return res.status(400).json({ success: false, message: 'MFA not enabled or user invalid' });

    if (!user.mfaCode || Date.now() > user.mfaCodeExpires)
      return res.status(400).json({ success: false, message: 'MFA code expired' });

    if (String(user.mfaCode) !== String(code))
      return res.status(400).json({ success: false, message: 'Invalid MFA code' });

    await User.update(user._id, { mfaCode: null, mfaCodeExpires: null });

    const tokenJwt = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );

    res.json({ success: true, message: 'MFA verified successfully', token: tokenJwt });
  } catch (err) {
    next(err);
  }
}
async function getProfile(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    // Get the user ID from the auth middleware
    const userId = String(req.user._id || req.user.id);

    // Fetch the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Select only the fields you want to return
    const {
      _id,
      name,
      prefix,
      email,
      role,
      isActive,
      department,
      facultyID,
      college,
      currentCredit,
      creditsByYear,
      mfaEnabled,
      mfaEmailEnabled,
      mfaAppEnabled,
      createdAt,
      updatedAt,
      apiKey,
    } = user;

    res.json({
      success: true,
      user: {
        _id,
        name,
        prefix,
        email,
        role,
        isActive,
        department,
        facultyID,
        college,
        currentCredit,
        creditsByYear,
        mfaEnabled,
        mfaEmailEnabled,
        mfaAppEnabled,
        createdAt,
        updatedAt,
        apiKey,
      },
    });
  } catch (err) {
    next(err);
  }
}
/**
 * @desc Change password for logged-in user
 * @route POST /api/v1/auth/change-password
 * @access Private (requires JWT)
 */
async function changePassword(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = String(req.user._id || req.user.id);

    // Validate fields
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    // Check current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update in DynamoDB
    await User.update(user._id, {
      password: hashedPassword,
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Change password error:', err);
    next(err);
  }
}



module.exports = { register, login, getProfile, changePassword, refreshToken, bulkRegister, forgotPassword, resetPassword, verifyMfa, enableAppMfa, verifyAppMfaSetup, toggleEmailMfa, disableAllMfa, };

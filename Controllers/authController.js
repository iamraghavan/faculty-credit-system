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

const fs = require('fs').promises;
const path = require('path');
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
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Missing credentials' });

    const users = await User.find({ email });
    if (users.length === 0)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const user = users[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    // Recalculate credits only for faculty
    if (user.role === 'faculty') {
      try {
        await recalcFacultyCredits(user._id);
      } catch (err) {
        console.error('Credit recalculation failed', err);
      }
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );

    const freshUser = await User.findById(user._id);

    res.json({
      success: true,
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


module.exports = { register, login, refreshToken, bulkRegister  };

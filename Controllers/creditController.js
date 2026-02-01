// controllers/creditController.js

const Credit = require('../Models/Credit');
const User = require('../Models/User'); // assuming this is still mongoose-backed
const CreditTitle = require('../Models/CreditTitle');
const { uploadFileToGitHub, uploadFileToGitHubBuffer } = require('../utils/githubUpload');
const fs = require('fs');
const fsPromises = require('fs').promises; // Add for async reads
const path = require('path');
const { sendEmail } = require('../utils/email');
const { generateRemarkPdf } = require('../utils/pdfGenerator');
const { sendPushToUser } = require('../Controllers/pushController');
const { recalcFacultyCredits } = require('../utils/calculateCredits');
const io = require('../socket');
const { connectDB } = require('../config/db');

/**
 * Helper: ensure DynamoDB client is connected
 */
async function ensureDb() {
  try {
    await connectDB();
  } catch (err) {
    // If connectDB logs, keep behaviour; rethrow so controller handlers return 500.
    throw err;
  }
}

/**
 * Helper: handle GitHub file upload and return proofUrl & proofMeta
 */
async function handleFileUpload(file, folder) {
  if (!file) return {};

  const hasBuffer = !!file.buffer;
  const tmpPath = file.path; // may be undefined for memoryStorage
  const originalName = file.originalname || `upload-${Date.now()}`;
  const safeName = path.basename(originalName).replace(/[^\w.\-() ]+/g, '_').slice(0, 200);
  const destPath = `${folder}/${Date.now()}_${safeName}`;

  if (!process.env.GITHUB_TOKEN || !process.env.ASSET_GH_REPO || !process.env.ASSET_GH_OWNER) {
    // if there's a tmpPath on disk, attempt to remove it
    if (tmpPath) {
      try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
    }
    throw new Error('GitHub upload not configured. Set ASSET_GH_OWNER, ASSET_GH_REPO, and GITHUB_TOKEN.');
  }

  try {
    let proofUrl;
    if (hasBuffer) {
      // Use your buffer-based uploader
      // uploadFileToGitHubBuffer(buffer, destPath, filename?) — adapt signature if needed
      proofUrl = await uploadFileToGitHubBuffer(file.buffer, destPath, safeName);
    } else if (tmpPath) {
      // Disk-based path present
      proofUrl = await uploadFileToGitHub(tmpPath, destPath);
    } else {
      // Neither buffer nor path — defensive error
      throw new Error('Uploaded file has no buffer or path.');
    }

    // Try to clean up tmpPath if it exists
    if (tmpPath) {
      try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore cleanup errors */ }
    }

    return {
      proofUrl,
      proofMeta: {
        originalName,
        size: file.size || (file.buffer ? file.buffer.length : undefined),
        mimeType: file.mimetype,
        destPath,
      },
    };
  } catch (err) {
    // Attempt cleanup if disk file was created
    if (tmpPath) {
      try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
    }
    // Re-throw with a clear message (controller logs it)
    throw new Error('Failed to upload file to GitHub: ' + (err && err.message ? err.message : String(err)));
  }
}

/**
 * Faculty submits positive credit
 */
async function submitPositiveCredit(req, res, next) {
  try {
    await ensureDb();

    const faculty = req.user;
    if (!faculty || faculty.role !== 'faculty')
      return res.status(403).json({ success: false, message: 'Forbidden' });

    let { title, points, categories, academicYear, notes } = req.body;
    if (!title || !points || !academicYear)
      return res.status(400).json({ success: false, message: 'Missing required fields' });

    points = Number(points);
    if (points <= 0 || isNaN(points))
      return res.status(400).json({ success: false, message: 'Points must be a positive number' });

    // Validate categories if provided (categories are expected to be CreditTitle IDs)
    let categoryIds = [];
    if (categories) {
      if (!Array.isArray(categories)) categories = String(categories).split(',');
      categoryIds = categories.map(c => String(c).trim()).filter(Boolean);

      // validate category IDs exist (using CreditTitle.find with filter)
      if (categoryIds.length > 0) {
        const found = await CreditTitle.find({}); // returns all titles, we'll filter locally
        const foundIds = new Set(found.map(t => String(t._id)));
        const invalid = categoryIds.filter(id => !foundIds.has(String(id)));
        if (invalid.length > 0) {
          return res.status(400).json({ success: false, message: 'Invalid category IDs', invalidIds: invalid });
        }
      }
    }

    const { proofUrl, proofMeta } = await handleFileUpload(req.file, `credits/${academicYear}`);

    const creditDoc = await Credit.create({
      faculty: String(faculty._id),
      facultySnapshot: {
        facultyID: faculty.facultyID,
        name: faculty.name,
        college: faculty.college,
        department: faculty.department,
      },
      type: 'positive',
      title,
      points,
      categories: categoryIds,
      proofUrl,
      proofMeta,
      academicYear,
      issuedBy: String(faculty._id),
      status: 'pending',
      notes: notes || undefined,
    });

    // recalc and emit
    try { await recalcFacultyCredits(faculty._id); } catch (e) { /* log but continue */ }
    io.emit(`faculty:${faculty._id}:creditUpdate`, creditDoc);

    return res.status(201).json({ success: true, data: creditDoc });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin issues negative credit
 */
async function adminIssueNegativeCredit(req, res, next) {
  try {
    await ensureDb();

    const actor = req.user;
    const { facultyId, creditTitleId, academicYear, notes } = req.body;

    if (!facultyId || !creditTitleId || !academicYear)
      return res.status(400).json({ success: false, message: 'Missing required fields' });

    // find faculty (User model assumed mongoose)
    const faculty = await User.findById(facultyId);
    if (!faculty) return res.status(404).json({ success: false, message: 'Faculty not found' });

    // find credit title (from Dynamo)
    const ct = await CreditTitle.findById(creditTitleId);
    if (!ct || ct.type !== 'negative')
      return res.status(400).json({ success: false, message: 'Invalid negative credit title' });

    const { proofUrl, proofMeta } = await handleFileUpload(req.file, academicYear);

    const pointsValue = -Math.abs(Number(ct.points || 0));

    const c = await Credit.create({
      faculty: String(faculty._id),
      facultySnapshot: {
        facultyID: faculty.facultyID,
        name: faculty.name,
        college: faculty.college,
        department: faculty.department,
      },
      type: 'negative',
      title: ct.title || ct._id,
      points: pointsValue,
      proofUrl,
      proofMeta,
      academicYear,
      issuedBy: String(actor._id),
      status: 'pending',
      notes: notes || undefined,
    });

    // recalc then emit
    try { await recalcFacultyCredits(faculty._id); } catch (e) { /* log and continue */ }

    io.emit(`faculty:${faculty._id}:creditUpdate`, c);

    // --- Prepare Notification (Email + PDF) ---
    try {
      const issuerName = actor.name || 'Administrator';
      const dateStr = new Date().toLocaleDateString('en-IN', { dateStyle: 'long' });
      const portalUrl = process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/faculty/credits` : '#';

      // 1. Generate PDF
      const pdfBuffer = await generateRemarkPdf({
        title: ct.title,
        points: pointsValue,
        academicYear,
        notes,
        facultyName: faculty.name,
        facultyId: faculty.facultyID,
        issuerName,
        date: dateStr
      });

      // 2. Read HTML Template
      const templatePath = path.resolve(process.cwd(), 'email-templates', 'remark-notification.html');
      let htmlContent = await fsPromises.readFile(templatePath, 'utf8');

      // 3. Replace Placeholders
      htmlContent = htmlContent
        .replace(/{{\s*facultyName\s*}}/g, faculty.name)
        .replace(/{{\s*remarkTitle\s*}}/g, ct.title)
        .replace(/{{\s*remarkPoints\s*}}/g, Math.abs(pointsValue)) // Show absolute value in HTML usually
        .replace(/{{\s*remarkMessage\s*}}/g, notes || 'No additional notes provided.')
        .replace(/{{\s*date\s*}}/g, dateStr)
        .replace(/{{\s*issuerName\s*}}/g, issuerName)
        .replace(/{{\s*portalUrl\s*}}/g, portalUrl)
        .replace(/{{\s*currentYear\s*}}/g, new Date().getFullYear());

      // 4. Send Email with Attachment
      await sendEmail({
        to: faculty.email,
        subject: `Startling Alert - Remark Notification: ${ct.title}`,
        text: `Remark Notification: ${ct.title}\nPoints: ${pointsValue}\nPlease check the attached PDF for details.`,
        html: htmlContent,
        attachments: [
          {
            filename: `Remark_Notification_${Date.now()}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
          }
        ]
      });

      // 5. Send Web Push Notification
      sendPushToUser(String(faculty._id), {
        title: 'New Remark Received',
        body: `${ct.title} (${pointsValue} credits). Check your portal.`,
        url: portalUrl,
        icon: '/icons/warning.png' // Ensure this exists on frontend public
      });

    } catch (notifyErr) {
      console.error('Failed to send remark notification:', notifyErr);
      // Don't fail the request, just log
    }

    return res.status(201).json({ success: true, data: c });
  } catch (err) {
    next(err);
  }
}

/**
 * List credits for faculty (frontend-friendly)
 * GET /api/v1/credits/faculty/:facultyId?academicYear=2024-2025&status=Approved&page=1&limit=20
 */
async function listCreditsForFaculty(req, res, next) {
  try {
    await ensureDb();

    const { facultyId } = req.params;
    const { page = 1, limit = 20, academicYear, status } = req.query;

    if (!facultyId) return res.status(400).json({ success: false, message: 'Missing facultyId' });

    // Build filter
    const filter = {};
    filter.faculty = String(facultyId);

    if (academicYear && String(academicYear).trim().toLowerCase() !== 'all') {
      filter.academicYear = String(academicYear).trim();
    }

    if (status && String(status).trim().toLowerCase() !== 'all') {
      const allowed = ['pending', 'approved', 'rejected', 'appealed'];
      const statusNorm = String(status).trim().toLowerCase();
      if (!allowed.includes(statusNorm)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status filter. Allowed values: ${['All', ...allowed.map(s => s.charAt(0).toUpperCase() + s.slice(1))].join(', ')}`
        });
      }
      filter.status = statusNorm;
    }

    // get all matching credits (Credit.find does an async Scan and filters equality)
    let items = await Credit.find(filter);

    // sort by createdAt desc
    items.sort((a, b) => {
      if (!a.createdAt && !b.createdAt) return 0;
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return b.createdAt.localeCompare(a.createdAt);
    });

    const total = items.length;
    const skip = (Math.max(Number(page), 1) - 1) * Math.max(Number(limit), 1);
    const paged = items.slice(skip, skip + Math.max(Number(limit), 1));

    // Optionally populate some fields using User model for issuedBy or faculty snapshots are already present
    // Keep payload lean: we return the items as-is (they include facultySnapshot), but you can expand here if needed.

    return res.json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      filters: { academicYear: academicYear || 'All', status: status || 'All' },
      items: paged,
    });
  } catch (err) {
    console.error('listCreditsForFaculty error:', err);
    next(err);
  }
}

/**
 * Admin creates credit title
 */
async function createCreditTitle(req, res, next) {
  try {
    await ensureDb();

    const actor = req.user;
    const { title, points, type, description } = req.body;
    if (!title || points === undefined) return res.status(400).json({ success: false, message: 'Title and points are required' });

    const ct = await CreditTitle.create({
      title,
      points: Number(points),
      type: type || 'positive',
      description,
      createdBy: String(actor._id),
    });

    return res.status(201).json({ success: true, data: ct });
  } catch (err) {
    next(err);
  }
}

/**
 * List credit titles
 */
async function listCreditTitles(req, res, next) {
  try {
    await ensureDb();
    const items = await CreditTitle.find({}); // model filters in-memory
    // If you have isActive flag use find({ isActive: true })
    return res.json({ success: true, total: items.length, items });
  } catch (err) {
    next(err);
  }
}

/**
 * Get all negative credits for a faculty (faculty self)
 */
async function getNegativeCredits(req, res, next) {
  try {
    await ensureDb();

    const faculty = req.user;
    if (!faculty || faculty.role !== 'faculty')
      return res.status(403).json({ success: false, message: 'Forbidden' });

    const { page = 1, limit = 20, status, academicYear, sort = '-createdAt' } = req.query;

    const filter = { faculty: String(faculty._id), type: 'negative' };

    if (status && status.toLowerCase() !== 'all') filter.status = status.toLowerCase();
    if (academicYear && academicYear.toLowerCase() !== 'all') filter.academicYear = academicYear;

    let items = await Credit.find(filter);

    // sort. support 'createdAt' or '-createdAt'
    const desc = String(sort).startsWith('-');
    const sortKey = desc ? sort.slice(1) : sort;
    items.sort((a, b) => {
      const va = a[sortKey] || '';
      const vb = b[sortKey] || '';
      return desc ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb));
    });

    const total = items.length;
    const skip = (Math.max(Number(page), 1) - 1) * Math.max(Number(limit), 1);
    const paged = items.slice(skip, skip + Number(limit));

    return res.json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      filters: { academicYear: academicYear || 'All', status: status || 'All' },
      items: paged,
    });
  } catch (err) {
    console.error('getNegativeCredits error:', err);
    next(err);
  }
}

/**
 * Faculty appeals negative credit
 */
async function appealNegativeCredit(req, res, next) {
  try {
    await ensureDb();

    const faculty = req.user;
    const creditId = req.params.creditId;
    const reason = (req.body.reason || '').trim();

    if (!reason) return res.status(400).json({ success: false, message: 'Appeal reason required' });
    if (!creditId) return res.status(400).json({ success: false, message: 'creditId required' });

    const credit = await Credit.findById(creditId);
    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });

    if (credit.type !== 'negative')
      return res.status(400).json({ success: false, message: 'Only negative credits can be appealed' });

    if (String(credit.faculty) !== String(faculty._id))
      return res.status(403).json({ success: false, message: 'Unauthorized' });

    if (credit.appeal && credit.appeal.status === 'pending')
      return res.status(400).json({ success: false, message: 'An appeal is already pending for this credit' });

    const currentAttempts = credit.appealCount || 0;
    if (currentAttempts >= 2)
      return res.status(400).json({ success: false, message: 'Maximum number of appeals (2) has been reached' });

    let proofUrl, proofMeta;
    if (req.file) {
      const uploadResult = await handleFileUpload(req.file, `appeals/${creditId}`);
      proofUrl = uploadResult.proofUrl;
      proofMeta = uploadResult.proofMeta;
    }

    const appealObj = {
      by: String(faculty._id),
      reason,
      proofUrl,
      proofMeta,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    // update the credit in Dynamo
    await Credit.update(creditId, {
      appeal: appealObj,
      status: 'appealed',
      appealCount: currentAttempts + 1,
      updatedAt: new Date().toISOString(),
    });

    // fetch updated credit to return
    const updated = await Credit.findById(creditId);

    // Optionally emit socket
    io.emit(`faculty:${faculty._id}:creditUpdate`, updated);

    return res.json({ success: true, message: 'Appeal submitted successfully', data: updated });
  } catch (err) {
    console.error('appealNegativeCredit error:', err);
    next(err);
  }
}

/**
 * Admin: Get negative credits by facultyId
 */
async function getNegativeCreditsByFacultyId(req, res, next) {
  try {
    await ensureDb();

    const { facultyId } = req.params;
    const { page = 1, limit = 20, status, academicYear, sort = '-createdAt' } = req.query;

    if (!facultyId) return res.status(400).json({ success: false, message: 'Invalid or missing facultyId' });

    const filter = { faculty: String(facultyId), type: 'negative' };
    if (status && status.toLowerCase() !== 'all') filter.status = status.toLowerCase();
    if (academicYear && academicYear.toLowerCase() !== 'all') filter.academicYear = academicYear;

    let items = await Credit.find(filter);

    // sort
    const desc = String(sort).startsWith('-');
    const sortKey = desc ? sort.slice(1) : sort;
    items.sort((a, b) => {
      const va = a[sortKey] || '';
      const vb = b[sortKey] || '';
      return desc ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb));
    });

    const total = items.length;
    const skip = (Math.max(Number(page), 1) - 1) * Math.max(Number(limit), 1);
    const paged = items.slice(skip, skip + Number(limit));

    return res.json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      filters: {
        academicYear: academicYear || 'All',
        status: status || 'All',
      },
      items: paged,
    });
  } catch (err) {
    console.error('getNegativeCreditsByFacultyId error:', err);
    next(err);
  }
}

/**
 * Recalculate credits for a faculty (controller)
 */
async function recalcCreditsController(req, res, next) {
  try {
    await ensureDb();

    const facultyId = req.params.facultyId || req.body.facultyId;
    if (!facultyId) return res.status(400).json({ success: false, message: 'facultyId is required' });

    // ensure user exists
    const user = await User.findById(facultyId);
    if (!user) return res.status(404).json({ success: false, message: 'faculty is not found' });

    const result = await recalcFacultyCredits(facultyId);

    return res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET faculty credits summary / stats (optimized + time-series aggregations)
 *
 * Query params (optional):
 *  - recalc=true|false
 *  - period=daily|weekly|monthly|quarterly|yearly|academicYear   (default: monthly)
 *  - startDate=YYYY-MM-DD    (inclusive)
 *  - endDate=YYYY-MM-DD      (inclusive)
 *  - tz=Asia/Kolkata         (IANA timezone string; default Asia/Kolkata for IST)
 */
async function getFacultyCredits(req, res, next) {
  try {
    const { facultyId } = req.params;
    const { recalc } = req.query;
    const period = (req.query.period || 'monthly').toLowerCase();
    const startDateRaw = req.query.startDate || null;
    const endDateRaw = req.query.endDate || null;
    const tz = req.query.tz || 'Asia/Kolkata'; // default to IST for display/grouping

    if (!facultyId) {
      return res.status(400).json({
        success: false,
        message: 'facultyId is required in URL params',
      });
    }

    // ---------- FIND USER ----------
    let user = null;
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(facultyId);

    if (isObjectId && User.findById) {
      try {
        const maybeUser = await User.findById(facultyId);
        if (maybeUser) user = maybeUser;
      } catch (e) {
        // ignore
      }
    }

    if (!user && User.find) {
      const results = await User.find({ facultyID: facultyId });
      if (results && results.length > 0) user = results[0];
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'Faculty not found' });
    }

    const userId = user._id;

    // ---------- OPTIONAL RECALCULATION ----------
    if (String(recalc).toLowerCase() === 'true') {
      try {
        await recalcFacultyCredits(userId);
      } catch (err) {
        console.error('Recalc failed:', err);
      }
      // refresh user
      if (User.findById) {
        user = await User.findById(userId);
      } else {
        const refreshed = await User.find({ _id: userId });
        if (refreshed && refreshed.length > 0) user = refreshed[0];
      }
    }

    // ---------- FETCH CREDITS ----------
    let credits = [];
    if (Credit.find) {
      credits = await Credit.find({ faculty: String(userId) });
    }

    // ---------- quick helpers ----------
    const EXCLUDE_STATUS = new Set(['pending', 'deleted']);
    const parseDateSafe = (s) => {
      if (!s) return null;
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };
    const startDate = startDateRaw ? parseDateSafe(startDateRaw) : null;
    const endDate = endDateRaw ? parseDateSafe(endDateRaw) : null;
    // normalize endDate to end of day if provided
    if (endDate) {
      endDate.setHours(23, 59, 59, 999);
    }

    // timezone-aware local date extraction helper using Intl
    function toLocalDateParts(date, tzArg) {
      // returns { year, month (1-12), day, weekday } in the timezone
      const str = date.toLocaleString('en-US', { timeZone: tzArg, hour12: false });
      // str like "11/12/2025, 2:27:12"
      // parse via Date with tz by splitting components using toLocaleString against timezone
      const [datePart, timePart] = str.split(',').map(s => s.trim());
      const [m, d, y] = datePart.split('/').map(Number);
      // month m, day d, year y
      const weekday = new Date(date.toLocaleString('en-US', { timeZone: tzArg, weekday: 'short' })).toLocaleString();
      return { year: y, month: m, day: d, weekday };
    }

    // ISO week number (Gregorian) helper (based on UTC date)
    function getISOWeekKey(date, tzArg) {
      // compute ISO week using local time in tzArg by constructing a Date at the local midnight
      // we'll use UTC calculations on a date that represents the same instant — acceptable for grouping
      const d = new Date(date.getTime());
      // Set to Thursday in current week: ISO week date rule
      const day = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
      d.setUTCDate(d.getUTCDate() - day + 3);
      const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
      const weekNo = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
      const year = d.getUTCFullYear();
      return `${year}-W${String(weekNo).padStart(2, '0')}`;
    }

    // Determine academicYear label (prefer existing credit.academicYear if present)
    function getAcademicYearFromCredit(c) {
      if (c.academicYear) return c.academicYear;
      // fallback: infer from createdAt using July as start of academic year (common)
      const dt = c.createdAt ? new Date(c.createdAt) : new Date();
      const y = dt.getFullYear();
      const m = dt.getMonth() + 1; // 1..12
      // academic year starts July (7) — adjust if you want June or August
      if (m >= 7) return `${y}-${y + 1}`;
      return `${y - 1}-${y}`;
    }

    // Create a period key string (for grouping) for a date
    function getPeriodKey(date, periodType) {
      if (!date) return 'unknown';
      const d = new Date(date);
      switch (periodType) {
        case 'daily': {
          // YYYY-MM-DD in tz by shifting to locale-based toISOString-like string
          const parts = d.toLocaleString('en-CA', { timeZone: tz }).split(',')[0]; // en-CA gives yyyy-mm-dd
          return parts; // "YYYY-MM-DD"
        }
        case 'weekly': {
          // Use ISO week key based on UTC week calc (stable)
          return getISOWeekKey(d, tz);
        }
        case 'monthly': {
          const parts = d.toLocaleString('en-CA', { timeZone: tz }).split(',')[0]; // YYYY-MM-DD
          return parts.slice(0, 7); // "YYYY-MM"
        }
        case 'quarterly': {
          // Q1 = Jan-Mar, Q2 = Apr-Jun, Q3 = Jul-Sep, Q4 = Oct-Dec
          const parts = d.toLocaleString('en-CA', { timeZone: tz }).split(',')[0];
          const [yStr, ,] = parts.split('-');
          const month = d.toLocaleString('en-US', { timeZone: tz }).split('/')[0]; // mm
          const mNum = Number(month);
          const q = Math.floor((mNum - 1) / 3) + 1;
          return `${yStr}-Q${q}`;
        }
        case 'yearly': {
          const y = d.toLocaleString('en-US', { timeZone: tz }).split('/')[2]; // yyyy
          return String(y);
        }
        case 'academicyear':
        case 'academicYear':
          return getAcademicYearFromCredit({ createdAt: d.toISOString() });
        default: {
          // default to monthly
          const parts2 = d.toLocaleString('en-CA', { timeZone: tz }).split(',')[0];
          return parts2.slice(0, 7);
        }
      }
    }

    // ---------- AGGREGATE: single-pass ----------
    // totals and per-period maps
    let totalPositiveCount = 0;
    let totalNegativeCount = 0;
    let totalPositivePoints = 0;
    let totalNegativePoints = 0;

    const creditsCountByYear = Object.create(null);
    const positiveCountByYear = Object.create(null);
    const negativeCountByYear = Object.create(null);
    const positivePointsByYear = Object.create(null);
    const negativePointsByYear = Object.create(null);

    // period maps: { periodKey: { positivePoints, negativePoints, positiveCount, negativeCount, net } }
    const periodMap = Object.create(null);
    const yearsSeen = new Set();

    function negativeShouldApply(credit) {
      if (!credit.appeal) return String(credit.status) === 'approved';
      const raw = credit.appeal.status;
      const status = raw === undefined || raw === null ? '' : String(raw).trim().toLowerCase();
      if (status === 'rejected') return true;
      return false;
    }

    for (let i = 0; i < credits.length; i++) {
      const c = credits[i];
      if (!c) continue;

      // status filtering - skip pending/deleted (also skip if appeal.status is pending/deleted)
      const st = (c.status || '').toString().trim().toLowerCase();
      if (EXCLUDE_STATUS.has(st)) continue;
      const appealSt = c.appeal && c.appeal.status ? String(c.appeal.status).trim().toLowerCase() : '';
      if (appealSt && EXCLUDE_STATUS.has(appealSt)) continue;

      // respect startDate/endDate filtering based on createdAt (or updatedAt if you prefer)
      const createdAt = c.createdAt ? new Date(c.createdAt) : null;
      if (!createdAt) continue; // skip items with no date
      if (startDate && createdAt < startDate) continue;
      if (endDate && createdAt > endDate) continue;

      const year = c.academicYear || getAcademicYearFromCredit(c);
      yearsSeen.add(year);
      creditsCountByYear[year] = (creditsCountByYear[year] || 0) + 1;

      // points coercion
      const pts = Number(c.points ?? 0) || 0;

      // period key (for requested period) - for academicYear grouping we use c.academicYear
      const periodKey = period === 'academicyear' || period === 'academicyear' ? (c.academicYear || year) : getPeriodKey(createdAt, period);

      if (!periodMap[periodKey]) {
        periodMap[periodKey] = {
          positivePoints: 0,
          negativePoints: 0,
          positiveCount: 0,
          negativeCount: 0,
          net: 0,
        };
      }

      if (String(c.type) === 'positive') {
        // only count positives that are approved (pending/deleted already excluded)
        if (String(c.status).toLowerCase() === 'approved') {
          totalPositiveCount++;
          totalPositivePoints += pts;
          positiveCountByYear[year] = (positiveCountByYear[year] || 0) + 1;
          positivePointsByYear[year] = (positivePointsByYear[year] || 0) + pts;

          periodMap[periodKey].positivePoints += pts;
          periodMap[periodKey].positiveCount += 1;
          periodMap[periodKey].net += pts;
        }
      } else if (String(c.type) === 'negative') {
        totalNegativeCount++;
        // accumulate negative points always as sum; whether it actually applies (deduction) is decided by negativeShouldApply for applied counts
        // For "sum of negatives" user asked, we treat negative sum as absolute of points in negative credits (excluding pending/deleted)
        const negPts = Math.abs(pts);
        totalNegativePoints += negPts;
        negativeCountByYear[year] = (negativeCountByYear[year] || 0) + 1;
        negativePointsByYear[year] = (negativePointsByYear[year] || 0) + negPts;

        periodMap[periodKey].negativePoints += negPts;
        periodMap[periodKey].negativeCount += 1;
        periodMap[periodKey].net -= negPts;
      } else {
        // unknown type: still counted in creditsCountByYear but not in totals
      }
    } // end credits loop

    // build sorted series from periodMap
    const periodKeys = Object.keys(periodMap).sort((a, b) => {
      // try lexicographic sort which works for ISO-like keys (YYYY-MM, YYYY-MM-DD, YYYY-Www, YYYY-Qn)
      return a.localeCompare(b);
    });

    const series = periodKeys.map((k) => ({
      period: k,
      positivePoints: periodMap[k].positivePoints,
      negativePoints: periodMap[k].negativePoints,
      net: periodMap[k].net,
      positiveCount: periodMap[k].positiveCount,
      negativeCount: periodMap[k].negativeCount,
    }));

    // If no explicit start/end provided and period=monthly, optionally return last 12 months series
    let trimmedSeries = series;
    if (!startDate && !endDate && period === 'monthly' && series.length > 12) {
      trimmedSeries = series.slice(-12);
    }

    // current academic year logic (prefer constructed current year if present)
    const now = new Date();
    const y = now.getFullYear();
    const constructedAcademicYear = `${y}-${y + 1}`;
    let currentAcademicYear = constructedAcademicYear;

    if (!yearsSeen.has(constructedAcademicYear)) {
      const yearsArray = Array.from(yearsSeen).filter(Boolean).sort();
      if (yearsArray.length === 0) currentAcademicYear = null;
      else currentAcademicYear = yearsArray[yearsArray.length - 1];
    }

    let currentYearStats = null;
    if (currentAcademicYear) {
      currentYearStats = {
        academicYear: currentAcademicYear,
        totalCredits: creditsCountByYear[currentAcademicYear] || 0,
        totalPositive: positiveCountByYear[currentAcademicYear] || 0,
        totalNegative: negativeCountByYear[currentAcademicYear] || 0,
        positivePoints: positivePointsByYear[currentAcademicYear] || 0,
        negativePoints: negativePointsByYear[currentAcademicYear] || 0,
        netForYear:
          (positivePointsByYear[currentAcademicYear] || 0) -
          (negativePointsByYear[currentAcademicYear] || 0),
      };
    }

    const stats = {
      totalCreditsCount: Object.values(creditsCountByYear).reduce((a, b) => a + b, 0),
      totalPositiveCount,
      totalNegativeCount,
      totalPositivePoints,
      totalNegativePoints,
      creditsCountByYear,
      positiveCountByYear,
      negativeCountByYear,
      positivePointsByYear,
      negativePointsByYear,
      currentAcademicYear,
      currentYearStats,
      series: trimmedSeries,         // time-series for requested period (array ordered by key)
      fullSeriesCount: series.length // how many unique periods available
    };

    return res.json({
      success: true,
      data: {
        name: user.name,
        facultyID: user.facultyID,
        currentCredit: user.currentCredit || 0,
        creditsByYear: user.creditsByYear || {},
        stats,
      },
    });
  } catch (err) {
    next(err);
  }
}


async function updatePositiveCredit(req, res, next) {
  try {
    await ensureDb();
    const { creditId } = req.params;
    const { title, points, academicYear, points: pointsBody, notes } = req.body; // points might be string
    const faculty = req.user;

    const credit = await Credit.findById(creditId);
    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });

    if (String(credit.faculty) !== String(faculty._id)) return res.status(403).json({ success: false, message: 'Unauthorized' });
    if (credit.status !== 'pending') return res.status(400).json({ success: false, message: 'Can only edit pending credits' });

    let updates = {};
    if (title) updates.title = title;
    if (points) updates.points = Number(points);
    if (academicYear) updates.academicYear = academicYear;
    if (notes !== undefined) updates.notes = notes;

    if (req.file) {
      const { proofUrl, proofMeta } = await handleFileUpload(req.file, `credits/${updates.academicYear || credit.academicYear}`);
      updates.proofUrl = proofUrl;
      updates.proofMeta = proofMeta;
    }

    updates.updatedAt = new Date().toISOString();

    await Credit.update(creditId, updates);
    const updated = await Credit.findById(creditId);

    io.emit(`faculty:${faculty._id}:creditUpdate`, updated);

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

async function deletePositiveCredit(req, res, next) {
  try {
    await ensureDb();
    const { creditId } = req.params;
    const faculty = req.user;
    const credit = await Credit.findById(creditId);
    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });
    if (String(credit.faculty) !== String(faculty._id)) return res.status(403).json({ success: false, message: 'Unauthorized' });
    if (credit.status !== 'pending') return res.status(400).json({ success: false, message: 'Can only delete pending credits' });

    await Credit.delete(creditId);
    res.json({ success: true, message: 'Credit deleted' });
  } catch (err) { next(err); }
}

async function updateAppeal(req, res, next) {
  try {
    await ensureDb();
    const { creditId } = req.params;
    const { reason } = req.body;
    const faculty = req.user;

    const credit = await Credit.findById(creditId);
    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });
    if (credit.type !== 'negative') return res.status(400).json({ success: false, message: 'Not a negative credit' });
    if (String(credit.faculty) !== String(faculty._id)) return res.status(403).json({ success: false, message: 'Unauthorized' });

    if (!credit.appeal || credit.status !== 'appealed') {
      return res.status(400).json({ success: false, message: 'No active appeal found to edit' });
    }
    if (credit.appeal.status !== 'pending') return res.status(400).json({ success: false, message: 'Cannot edit processed appeal' });

    const newAppeal = { ...credit.appeal };
    if (reason) newAppeal.reason = reason;

    if (req.file) {
      const { proofUrl, proofMeta } = await handleFileUpload(req.file, `appeals/${creditId}`);
      newAppeal.proofUrl = proofUrl;
      newAppeal.proofMeta = proofMeta;
    }

    await Credit.update(creditId, { appeal: newAppeal, updatedAt: new Date().toISOString() });
    const updated = await Credit.findById(creditId);

    io.emit(`faculty:${faculty._id}:creditUpdate`, updated);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

async function deleteAppeal(req, res, next) {
  try {
    await ensureDb();
    const { creditId } = req.params;
    const faculty = req.user;

    const credit = await Credit.findById(creditId);
    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });
    if (String(credit.faculty) !== String(faculty._id)) return res.status(403).json({ success: false, message: 'Unauthorized' });

    if (!credit.appeal) {
      return res.status(400).json({ success: false, message: 'No active appeal to delete' });
    }

    if (credit.appeal.status !== 'pending') return res.status(400).json({ success: false, message: 'Cannot delete processed appeal' });

    await Credit.update(creditId, {
      appeal: null,
      status: 'pending', // Revert to pending
      updatedAt: new Date().toISOString()
    });

    const updated = await Credit.findById(creditId);
    io.emit(`faculty:${faculty._id}:creditUpdate`, updated);
    res.json({ success: true, message: 'Appeal withdrawn', data: updated });
  } catch (err) { next(err); }
}

async function getSingleCredit(req, res, next) {
  try {
    await ensureDb();
    const { creditId } = req.params;
    const user = req.user;

    const credit = await Credit.findById(creditId);
    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });

    // Access Control:
    // 1. Admin/OA can see any credit
    // 2. Faculty can only see their own credits
    if (user.role === 'faculty' && String(credit.faculty) !== String(user._id)) {
      return res.status(403).json({ success: false, message: 'Unauthorized access to this credit' });
    }

    return res.json({ success: true, data: credit });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  submitPositiveCredit,
  appealNegativeCredit,
  listCreditsForFaculty,
  adminIssueNegativeCredit,
  createCreditTitle,
  listCreditTitles,
  getNegativeCredits,
  getNegativeCreditsByFacultyId,
  recalcCreditsController,
  getFacultyCredits,
  updatePositiveCredit,
  deletePositiveCredit,
  updateAppeal,
  deleteAppeal,
  getSingleCredit,
};

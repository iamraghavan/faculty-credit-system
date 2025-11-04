// controllers/creditController.js

const Credit = require('../Models/Credit');
const User = require('../Models/User'); // assuming this is still mongoose-backed
const CreditTitle = require('../Models/CreditTitle');
const { uploadFileToGitHub, uploadFileToGitHubBuffer } = require('../utils/githubUpload');
const fs = require('fs');
const path = require('path');
const { sendEmail } = require('../utils/email');
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
      points: -Math.abs(Number(ct.points || 0)),
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

    // send email (fire & forget)
    sendEmail({
      to: faculty.email,
      subject: `Negative Credit Issued: ${ct.title}`,
      text: `A negative credit (${ct.points}) has been issued against you for ${academicYear}. Reason: ${notes || 'Not provided'}`,
    }).catch(() => {});

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
 * GET faculty credits summary / stats
 */
async function getFacultyCredits(req, res, next) {
  try {
    await ensureDb();

    const { facultyId } = req.params;
    const { recalc } = req.query;

    if (!facultyId) {
      return res.status(400).json({ success: false, message: 'facultyId is required in URL params' });
    }

    // find user by _id or facultyID
    let user = null;
    // try mongoose _id
    if (facultyId && String(facultyId).match(/^[0-9a-fA-F]{24}$/)) {
      user = await User.findById(facultyId).select('name facultyID currentCredit creditsByYear');
    }
    if (!user) {
      user = await User.findOne({ facultyID: facultyId }).select('name facultyID currentCredit creditsByYear');
    }
    if (!user) {
      return res.status(404).json({ success: false, message: 'Faculty not found' });
    }

    // Optionally force recalculation (await)
    if (String(recalc).toLowerCase() === 'true') {
      try {
        await recalcFacultyCredits(user._id);
      } catch (err) {
        console.error('Recalc failed:', err);
      }
      user = await User.findById(user._id).select('name facultyID currentCredit creditsByYear');
    }

    // Fetch all credits for this user to compute stats
    const credits = await Credit.find({ faculty: String(user._id) });

    function negativeShouldApply(credit) {
      if (!credit.appeal) {
        return credit.status === 'approved';
      }
      const raw = credit.appeal.status;
      const status = (raw === undefined || raw === null) ? '' : String(raw).trim().toLowerCase();
      const emptyLike = status === '' || status === 'none' || status === 'null' || status === 'nil';
      if (status === 'rejected') return true;
      return false;
    }

    // Stats containers
    const positiveCountByYear = {};
    const negativeCountByYear = {};
    const appliedPositiveCountByYear = {};
    const appliedNegativeCountByYear = {};
    let totalPositiveCount = 0;
    let totalNegativeCount = 0;
    let appliedPositiveCount = 0;
    let appliedNegativeCount = 0;
    const creditsCountByYear = {};
    const yearsSeen = new Set();

    for (const c of credits) {
      const year = c.academicYear || 'unknown';
      yearsSeen.add(year);

      positiveCountByYear[year] = positiveCountByYear[year] || 0;
      negativeCountByYear[year] = negativeCountByYear[year] || 0;
      appliedPositiveCountByYear[year] = appliedPositiveCountByYear[year] || 0;
      appliedNegativeCountByYear[year] = appliedNegativeCountByYear[year] || 0;
      creditsCountByYear[year] = creditsCountByYear[year] || 0;

      creditsCountByYear[year] += 1;

      if (c.type === 'positive') {
        totalPositiveCount += 1;
        positiveCountByYear[year] += 1;
        if (c.status === 'approved') {
          appliedPositiveCount += 1;
          appliedPositiveCountByYear[year] += 1;
        }
      } else if (c.type === 'negative') {
        totalNegativeCount += 1;
        negativeCountByYear[year] += 1;
        if (negativeShouldApply(c)) {
          appliedNegativeCount += 1;
          appliedNegativeCountByYear[year] += 1;
        }
      }
    }

    // Decide currentAcademicYear heuristically
    const now = new Date();
    const y = now.getFullYear();
    const constructedAcademicYear = `${y}-${y + 1}`;
    let currentAcademicYear = constructedAcademicYear;
    if (!yearsSeen.has(constructedAcademicYear)) {
      const yearsArray = Array.from(yearsSeen);
      if (yearsArray.length === 0) {
        currentAcademicYear = null;
      } else {
        yearsArray.sort();
        currentAcademicYear = yearsArray[yearsArray.length - 1];
      }
    }

    let currentYearStats = null;
    if (currentAcademicYear) {
      currentYearStats = {
        academicYear: currentAcademicYear,
        totalCredits: creditsCountByYear[currentAcademicYear] || 0,
        totalPositive: positiveCountByYear[currentAcademicYear] || 0,
        totalNegative: negativeCountByYear[currentAcademicYear] || 0,
        appliedPositive: appliedPositiveCountByYear[currentAcademicYear] || 0,
        appliedNegative: appliedNegativeCountByYear[currentAcademicYear] || 0,
        netForYear: ((appliedPositiveCountByYear[currentAcademicYear] || 0) - (appliedNegativeCountByYear[currentAcademicYear] || 0)),
      };
    }

    const eventsApplied = appliedPositiveCount + appliedNegativeCount;

    const stats = {
      totalCreditsCount: credits.length,
      totalPositiveCount,
      totalNegativeCount,
      appliedPositiveCount,
      appliedNegativeCount,
      appliedPositiveCountByYear,
      appliedNegativeCountByYear,
      positiveCountByYear,
      negativeCountByYear,
      creditsCountByYear,
      eventsApplied,
      currentAcademicYear,
      currentYearStats,
    };

    const response = {
      success: true,
      data: {
        name: user.name,
        facultyID: user.facultyID,
        currentCredit: user.currentCredit || 0,
        creditsByYear: user.creditsByYear || {},
        stats,
      },
    };

    return res.json(response);
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
};

// controllers/creditController.js

const mongoose = require('mongoose'); // still used for User model id checks
const CreditTitle = require('../Models/CreditTitle'); // Dynamo model
const Credit = require('../Models/Credit'); // Dynamo model
const User = require('../Models/User'); // mongoose-backed
const fs = require('fs');
const path = require('path');

const { recalcFacultyCredits } = require('../utils/calculateCredits');
const { uploadFileToGitHub , uploadFileToGitHubBuffer} = require('../utils/githubUpload');
const { connectDB } = require('../config/db');

/**
 * Ensure DynamoDB client is connected
 */
async function ensureDb() {
  try {
    await connectDB();
  } catch (err) {
    throw err;
  }
}

/**
 * Helper to emit via socket
 */
const emitSocket = (req, event, payload) => {
  const io = req.app?.locals?.io;
  if (io) {
    io.emit(event, payload);
  }
};

/**
 * Helper: handle GitHub file upload and return proofUrl & proofMeta
 */
async function handleFileUpload(file, folder) {
  if (!file) return {};

  // prefer a sanitized filename, but handle both memory & disk multer storages
  const originalName = file.originalname || 'upload';
  const safeName = path.basename(originalName).replace(/[^\w.\-() ]+/g, '_').slice(0, 200);
  const destPath = `${folder}/${Date.now()}_${safeName}`;

  // If using memoryStorage, multer provides file.buffer
  const isBuffer = Buffer.isBuffer(file.buffer);
  const tmpPath = file.path; // may be undefined if memoryStorage is used

  if (!process.env.GITHUB_TOKEN || !process.env.ASSET_GH_REPO || !process.env.ASSET_GH_OWNER) {
    // try to cleanup only if there's a real tmpPath on disk
    if (tmpPath && typeof tmpPath === 'string') {
      try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
    }
    throw new Error('GitHub upload not configured. Set ASSET_GH_OWNER, ASSET_GH_REPO, and GITHUB_TOKEN.');
  }

  try {
    let proofUrl;
    if (isBuffer) {
      // Use buffer upload helper (does not require a disk path)
      proofUrl = await uploadFileToGitHubBuffer(file.buffer, destPath);
    } else if (tmpPath && typeof tmpPath === 'string') {
      // Disk-based multer -> upload by path
      proofUrl = await uploadFileToGitHub(tmpPath, destPath);
      // cleanup the temporary file after upload
      try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
    } else {
      // Neither buffer nor tmp path -> maybe client didn't send file correctly
      throw new Error('Uploaded file missing buffer and path (multer storage mismatch).');
    }

    return {
      proofUrl,
      proofMeta: {
        originalName,
        size: file.size || (file.buffer ? file.buffer.length : undefined),
        mimeType: file.mimetype,
      },
    };
  } catch (err) {
    // cleanup only if we have a tmpPath
    if (tmpPath && typeof tmpPath === 'string') {
      try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
    }
    // rethrow with clearer message
    throw new Error('Failed to upload file to GitHub: ' + (err && err.message ? err.message : String(err)));
  }
}

/**
 * Admin creates credit title (Dynamo)
 */
async function createCreditTitle(req, res, next) {
  try {
    await ensureDb();

    const actor = req.user;
    const { title, points, type, description } = req.body;
    if (!title || points === undefined) return res.status(400).json({ success: false, message: 'Title and points required' });

    const ct = await CreditTitle.create({
      title,
      points: Number(points),
      type: type || 'positive',
      description,
      createdBy: String(actor._id),
      isActive: true,
    });

    return res.status(201).json({ success: true, data: ct });
  } catch (err) {
    next(err);
  }
}

/**
 * List credit titles (Dynamo)
 */
async function listCreditTitles(req, res, next) {
  try {
    await ensureDb();
    // If your Dynamo model supports filter, you'd pass { isActive: true }
    const items = await CreditTitle.find({ isActive: true });
    return res.json({ success: true, total: items.length, items });
  } catch (err) {
    next(err);
  }
}

/**
 * Update credit title (Dynamo)
 */
async function updateCreditTitle(req, res, next) {
  try {
    await ensureDb();
    const { id } = req.params;
    const { title, points, type, description } = req.body;

    const existing = await CreditTitle.findById(id);
    if (!existing) return res.status(404).json({ success: false, message: 'Credit title not found' });

    const updated = await CreditTitle.update(id, {
      title: title ?? existing.title,
      points: points !== undefined ? Number(points) : existing.points,
      type: type ?? existing.type,
      description: description ?? existing.description,
      updatedAt: new Date().toISOString(),
    });

    return res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * Delete (soft) credit title (Dynamo)
 */
async function deleteCreditTitle(req, res, next) {
  try {
    await ensureDb();
    const { id } = req.params;

    const existing = await CreditTitle.findById(id);
    if (!existing) return res.status(404).json({ success: false, message: 'Credit title not found' });

    const updated = await CreditTitle.update(id, { isActive: false, updatedAt: new Date().toISOString() });
    return res.json({ success: true, message: 'Credit title deactivated', data: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin issues negative credit to faculty (Dynamo)
 * POST body: { facultyId, creditTitleId, title, points, notes, academicYear }
 */
async function issueNegativeCredit(req, res, next) {
  try {
    await ensureDb();

    const admin = req.user;
    const { facultyId, creditTitleId, title, points, notes, academicYear } = req.body;

    if (!facultyId || (!points && points !== 0) || !academicYear) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Find faculty (mongoose)
    const faculty = await User.findById(facultyId);
    if (!faculty) return res.status(404).json({ success: false, message: 'Faculty not found' });

    // find creditTitle (dynamo) if provided
    let creditTitle = null;
    if (creditTitleId) creditTitle = await CreditTitle.findById(creditTitleId);

    // upload file if provided
    let proofUrl, proofMeta;
    if (req.file) {
      const uploadResult = await handleFileUpload(req.file, `credits/${academicYear}`);
      proofUrl = uploadResult.proofUrl;
      proofMeta = uploadResult.proofMeta;
    }

    const creditItem = await Credit.create({
      faculty: String(faculty._id),
      facultySnapshot: {
        name: faculty.name,
        facultyID: faculty.facultyID,
        college: faculty.college,
        department: faculty.department,
      },
      type: 'negative',
      creditTitle: creditTitle ? String(creditTitle._id) : undefined,
      title: title || (creditTitle && creditTitle.title) || 'Negative Credit',
      points: Number(points),
      notes,
      academicYear,
      issuedBy: String(admin._id),
      proofUrl,
      proofMeta,
      status: 'pending',
    });

    // Recalc and emit
    try { await recalcFacultyCredits(faculty._id); } catch (e) { /* log & continue */ }
    emitSocket(req, 'credit:negative:new', { facultyId: String(faculty._id), credit: creditItem });

    return res.status(201).json({ success: true, data: creditItem });
  } catch (err) {
    next(err);
  }
}

/**
 * List negative credits for a specific faculty (Dynamo)
 */
async function listNegativeCreditsForFaculty(req, res, next) {
  try {
    await ensureDb();

    const { facultyId } = req.params;
    if (req.user.role !== 'faculty' && req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

    if (req.user.role === 'faculty' && String(req.user._id) !== String(facultyId)) {
      return res.status(403).json({ success: false, message: 'Cannot view other faculty credits' });
    }

    const items = await Credit.find({ faculty: String(facultyId), type: 'negative' });

    // sort desc by createdAt
    items.sort((a, b) => {
      if (!a.createdAt && !b.createdAt) return 0;
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return b.createdAt.localeCompare(a.createdAt);
    });

    // Optionally populate issuedBy and creditTitle by fetching separately (Dynamo doesn't populate)
    // For now we return facultySnapshot (present) and issuedBy id if needed.

    return res.json({ success: true, total: items.length, items });
  } catch (err) {
    next(err);
  }
}

/**
 * Positive credits listing for admin (Dynamo)
 * Query params: status, facultyId, academicYear, fromDate, toDate, page, limit, sort, search
 *
 * NOTE: Credit.find performs a full table scan and returns items filtered in-memory.
 * For production, create a GSI on (type, faculty) or similar and implement query.
 */
async function listPositiveCreditsForAdmin(req, res, next) {
  try {
    await ensureDb();

    const { status, facultyId, academicYear, fromDate, toDate, page = 1, limit = 20, sort = '-createdAt', search } = req.query;

    // Build filter object for Credit.find (equality checks). Complex filters (regex, date ranges) will be applied in-memory after scan.
    const baseFilter = { type: 'positive' };
    if (facultyId) baseFilter.faculty = String(facultyId);
    if (academicYear) baseFilter.academicYear = String(academicYear);

    // initial fetch (scan+filter)
    let items = await Credit.find(baseFilter);

    // in-memory filters:
    if (status) {
      const wanted = status.split(',').map(s => s.trim().toLowerCase());
      items = items.filter(it => wanted.includes(String(it.status || '').toLowerCase()));
    }

    if (fromDate || toDate) {
      items = items.filter(it => {
        const created = it.createdAt ? new Date(it.createdAt) : null;
        if (!created) return false;
        if (fromDate && created < new Date(fromDate)) return false;
        if (toDate && created > new Date(toDate)) return false;
        return true;
      });
    }

    if (search) {
      const q = String(search).trim().toLowerCase();
      items = items.filter(it => {
        const title = String(it.title || '').toLowerCase();
        const notes = String(it.notes || '').toLowerCase();
        const fname = String(it.facultySnapshot?.name || '').toLowerCase();
        const fid = String(it.facultySnapshot?.facultyID || '').toLowerCase();
        return title.includes(q) || notes.includes(q) || fname.includes(q) || fid.includes(q);
      });
    }

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
    const paged = items.slice(skip, skip + Math.max(Number(limit), 1));

    return res.json({ success: true, total, page: Number(page), limit: Number(limit), items: paged });
  } catch (err) {
    next(err);
  }
}

/**
 * Positive credit update status (Dynamo)
 * PATCH /.../:id/status  Body: { status, notes }
 */
async function updatePositiveCreditStatus(req, res, next) {
  try {
    await ensureDb();

    const { id } = req.params;
    const { status, notes } = req.body;

    const allowed = ['pending', 'approved', 'rejected', 'appealed'];
    if (!allowed.includes(String(status))) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const credit = await Credit.findById(id);
    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });
    if (credit.type !== 'positive') return res.status(400).json({ success: false, message: 'Not a positive credit' });

    // verify faculty exists
    const facultyId = credit.faculty;
    const faculty = await User.findById(facultyId);
    if (!faculty) return res.status(404).json({ success: false, message: 'Faculty not found' });

    const prevStatus = credit.status;
    const updatePayload = {
      status,
      updatedAt: new Date().toISOString(),
    };
    if (typeof notes !== 'undefined') updatePayload.notes = notes;

    await Credit.update(id, updatePayload);

    // fetch updated credit
    const updated = await Credit.findById(id);

    // Recalculate faculty totals (fire-and-wait)
    try {
      await recalcFacultyCredits(faculty._id);
    } catch (recalcErr) {
      console.error('recalcFacultyCredits failed:', recalcErr);
    }

    emitSocket(req, 'credit:positive:update', { credit: updated });

    return res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * Get positive credit by id (Dynamo)
 */
async function getPositiveCreditById(req, res, next) {
  try {
    await ensureDb();

    const { id } = req.params;
    const credit = await Credit.findById(id);
    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });
    if (credit.type !== 'positive') return res.status(400).json({ success: false, message: 'Not a positive credit' });

    // optionally fetch faculty info from mongoose to mimick populate
    let facultyInfo = null;
    if (credit.faculty && mongoose.isValidObjectId(credit.faculty)) {
      const u = await User.findById(credit.faculty).select('name facultyID email college department currentCredit creditsByYear').lean();
      facultyInfo = u || null;
    }

    // attach facultyInfo to response (like populate)
    const resp = { ...credit };
    resp.facultyPopulated = facultyInfo;

    return res.json({ success: true, data: resp });
  } catch (err) {
    next(err);
  }
}

/**
 * ADMIN: List all negative credits (Dynamo, paginated + filters)
 * GET /api/v1/admin/credits/negative
 */
async function adminListNegativeCredits(req, res, next) {
  try {
    await ensureDb();

    const {
      page = 1,
      limit = 20,
      academicYear = 'all',
      status = 'all',
      facultyId,
      templateId,
      college = 'all',
      department = 'all',
      sort = '-createdAt',
      search = ''
    } = req.query;

    // 1️⃣ Base filter
    const baseFilter = { type: 'negative' };

    if (academicYear.toLowerCase() !== 'all')
      baseFilter.academicYear = String(academicYear).trim();

    if (facultyId)
      baseFilter.faculty = String(facultyId).trim();

    // 2️⃣ Fetch all credits
    let items = await Credit.find(baseFilter);

    // 3️⃣ Filter by status
    if (status.toLowerCase() !== 'all') {
      const allowed = ['pending', 'approved', 'rejected', 'appealed'];
      const s = status.trim().toLowerCase();
      if (!allowed.includes(s)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed: ${allowed.join(', ')}`
        });
      }
      items = items.filter(it => String(it.status || '').toLowerCase() === s);
    }

    // 4️⃣ Filter by template / credit title
    if (templateId && templateId.toLowerCase() !== 'all') {
      items = items.filter(it => String(it.creditTitle) === String(templateId));
    }

    // 5️⃣ Filter by college / department (from faculty snapshot)
    if (college.toLowerCase() !== 'all') {
      items = items.filter(it =>
        String(it.facultySnapshot?.college || '').toLowerCase() === college.toLowerCase()
      );
    }

    if (department.toLowerCase() !== 'all') {
      items = items.filter(it =>
        String(it.facultySnapshot?.department || '').toLowerCase() === department.toLowerCase()
      );
    }

    // 6️⃣ Text search across multiple fields
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(it => {
        const fields = [
          it.title,
          it.notes,
          it.facultySnapshot?.name,
          it.facultySnapshot?.facultyID,
          it.creditTitle
        ];
        return fields.some(f => String(f || '').toLowerCase().includes(q));
      });
    }

    // 7️⃣ Sort (default: newest first)
    const desc = String(sort).startsWith('-');
    const sortKey = desc ? sort.slice(1) : sort;
    items.sort((a, b) => {
      const va = a[sortKey] || '';
      const vb = b[sortKey] || '';
      return desc
        ? String(vb).localeCompare(String(va))
        : String(va).localeCompare(String(vb));
    });

    // 8️⃣ Pagination
    const total = items.length;
    const skip = (Math.max(Number(page), 1) - 1) * Math.max(Number(limit), 1);
    const paged = items.slice(skip, skip + Math.max(Number(limit), 1));

    // 9️⃣ Enrich results with related info
    // (Optional: can fetch faculty/title info dynamically)
    const formattedItems = paged.map(it => ({
  creditId: it._id,
  // 🧑‍🏫 Faculty details
  facultyName: it.facultySnapshot?.name || '',
  facultyID: it.facultySnapshot?.facultyID || '',
  college: it.facultySnapshot?.college || '',
  department: it.facultySnapshot?.department || '',

  // 🧾 Credit info
  templateTitle: it.creditTitle || '',
  title: it.title || '',
  type: it.type || '',
  points: it.points || 0,
  status: it.status || '',
  issuedBy: it.issuedBy || '',
  proofMeta: it.proofMeta || null,
  proofUrl: it.proofUrl || '',

  // 📅 Timestamps
  createdAt: it.createdAt,
  updatedAt: it.updatedAt,

  // keep all original fields if frontend still needs them
  ...it
}));
    // 🔹 Optional: Distinct filter options for frontend dropdowns
    const distinctValues = {
      templates: [...new Set(items.map(i => i.creditTitle).filter(Boolean))],
      years: [...new Set(items.map(i => i.academicYear).filter(Boolean))],
      colleges: [...new Set(items.map(i => i.facultySnapshot?.college).filter(Boolean))],
      departments: [...new Set(items.map(i => i.facultySnapshot?.department).filter(Boolean))]
    };

    // ✅ Response
    return res.json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      filters: distinctValues, // new addition for UI dropdowns
      items: formattedItems
    });
  } catch (err) {
    next(err);
  }
}

/**
 * ADMIN: Get a single negative credit by id (Dynamo)
 */
async function adminGetNegativeCreditById(req, res, next) {
  try {
    await ensureDb();

    const { id } = req.params;
    // Accept flexible id but ensure present
    if (!id) return res.status(400).json({ success: false, message: 'Invalid credit id' });

    const credit = await Credit.findById(id);
    if (!credit) return res.status(404).json({ success: false, message: 'Negative credit not found' });
    if (credit.type !== 'negative') return res.status(400).json({ success: false, message: 'Credit is not negative' });

    // Optionally fetch faculty (mongoose) and issuedBy details
    let facultyInfo = null;
    if (credit.faculty && mongoose.isValidObjectId(credit.faculty)) {
      facultyInfo = await User.findById(credit.faculty).select('name facultyID email college department').lean();
    }

    const resp = { ...credit, facultyPopulated: facultyInfo };

    return res.json({ success: true, data: resp });
  } catch (err) {
    next(err);
  }
}

/**
 * ADMIN: Get faculty (id and basic info) by negative credit id (Dynamo)
 */
async function adminGetFacultyByNegativeCreditId(req, res, next) {
  try {
    await ensureDb();

    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: 'Invalid credit id' });

    const credit = await Credit.findById(id);
    if (!credit) return res.status(404).json({ success: false, message: 'Negative credit not found' });
    if (credit.type && credit.type !== 'negative') return res.status(400).json({ success: false, message: 'Not a negative credit' });

    // Use snapshot first
    let facultyInfo = credit.facultySnapshot || null;
    if ((!facultyInfo || !facultyInfo.name) && credit.faculty && mongoose.isValidObjectId(credit.faculty)) {
      const user = await User.findById(credit.faculty).select('name facultyID email college department').lean();
      facultyInfo = user || null;
    }

    return res.json({ success: true, data: { facultyId: credit.faculty, faculty: facultyInfo } });
  } catch (err) {
    next(err);
  }
}

/**
 * ADMIN: List negative credit appeals (Dynamo)
 */
async function adminListNegativeCreditAppeals(req, res, next) {
  try {
    await ensureDb();

    const { page = 1, limit = 20, status, facultyId, academicYear, sort = '-appeal.createdAt' } = req.query;

    // Base: type negative and appeal.by exists
    let items = await Credit.find({ type: 'negative' });
    items = items.filter(it => it.appeal && it.appeal.by);

    if (status) {
      items = items.filter(it => String(it.appeal?.status || '').toLowerCase() === String(status).toLowerCase());
    }

    if (facultyId && mongoose.isValidObjectId(facultyId)) {
      items = items.filter(it => String(it.faculty) === String(facultyId));
    }

    if (academicYear && String(academicYear).toLowerCase() !== 'all') {
      items = items.filter(it => it.academicYear === academicYear);
    }

    // sort by nested field (simple lexical)
    const desc = String(sort).startsWith('-');
    const sortKey = desc ? sort.slice(1) : sort; // e.g. 'appeal.createdAt' or 'appeal.createdAt'
    const keyParts = sortKey.split('.');
    items.sort((a, b) => {
      const va = keyParts.reduce((acc, k) => (acc ? acc[k] : undefined), a) || '';
      const vb = keyParts.reduce((acc, k) => (acc ? acc[k] : undefined), b) || '';
      return desc ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb));
    });

    const total = items.length;
    const skip = (Math.max(Number(page), 1) - 1) * Math.max(Number(limit), 1);
    const paged = items.slice(skip, skip + Math.max(Number(limit), 1));

    return res.json({ success: true, total, page: Number(page), limit: Number(limit), items: paged });
  } catch (err) {
    next(err);
  }
}

/**
 * Get negative appeals (Dynamo)
 */
async function getNegativeAppeals(req, res) {
  try {
    await ensureDb();

    const negativeAppeals = (await Credit.find({ type: 'negative' }))
      .filter(c => c.appeal && ['pending', 'accepted', 'rejected'].includes(String(c.appeal.status || '').toLowerCase()))
      .map(c => ({
        faculty: c.facultySnapshot || null,
        creditId: c._id,
        title: c.title,
        points: c.points,
        categories: c.categories,
        proofUrl: c.proofUrl,
        appeal: c.appeal,
        status: c.status,
        createdAt: c.createdAt,
      }));

    if (negativeAppeals.length === 0) {
      return res.status(404).json({ message: 'No negative appeals found' });
    }
    return res.status(200).json({ negativeAppeals });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
}

/**
 * ADMIN: Get a single appeal by negative credit ID (Dynamo)
 */
async function adminGetAppealByCreditId(req, res, next) {
  try {
    await ensureDb();

    const { creditId } = req.params;
    if (!creditId) return res.status(400).json({ success: false, message: 'Invalid creditId' });

    const credit = await Credit.findById(creditId);
    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });
    if (!credit.appeal || !credit.appeal.by) return res.status(404).json({ success: false, message: 'No appeal found for this credit' });

    return res.json({ success: true, data: credit.appeal });
  } catch (err) {
    next(err);
  }
}

/**
 * ADMIN: Update appeal status (Dynamo)
 * Body: { status: 'accepted' | 'rejected', notes: optional }
 */
async function adminUpdateAppealStatus(req, res, next) {
  try {
    await ensureDb();

    const { creditId } = req.params;
    const { status, notes } = req.body;

    const allowedStatuses = ['accepted', 'rejected'];
    if (!allowedStatuses.includes(status)) return res.status(400).json({ success: false, message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}` });

    const credit = await Credit.findById(creditId);
    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });

    if (!credit.appeal || !credit.appeal.by) return res.status(400).json({ success: false, message: 'No appeal found for this credit' });

    // Update appeal object and credit status if needed
    const newAppeal = {
      ...credit.appeal,
      status,
      updatedAt: new Date().toISOString(),
      notes: notes || credit.appeal.notes,
    };

    const updatePayload = {
      appeal: newAppeal,
      notes: notes || credit.notes || undefined,
      updatedAt: new Date().toISOString(),
    };

    // If appeal accepted, set credit.status to 'pending' for re-review (preserve previous logic)
    if (status === 'accepted' && credit.status !== 'pending') {
      updatePayload.status = 'pending';
    }

    await Credit.update(creditId, updatePayload);

    const updated = await Credit.findById(creditId);

    // Emit socket event if needed
    emitSocket(req, 'credit:appeal:update', { creditId: updated._id, appeal: updated.appeal });

    return res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createCreditTitle,
  listCreditTitles,
  updateCreditTitle,
  deleteCreditTitle,
  listPositiveCreditsForAdmin,
  updatePositiveCreditStatus,
  getPositiveCreditById,
  issueNegativeCredit,
  listNegativeCreditsForFaculty,
  adminListNegativeCredits,
  adminGetNegativeCreditById,
  adminGetFacultyByNegativeCreditId,
  adminListNegativeCreditAppeals,
  adminGetAppealByCreditId,
  adminUpdateAppealStatus,
  getNegativeAppeals,
};

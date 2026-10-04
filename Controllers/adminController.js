// controllers/creditController.js

const mongoose = require('mongoose'); // still used for User model id checks
const Credit = require('../Models/Credit'); // Dynamo model
const User = require('../Models/User'); // mongoose-backed

const { recalcFacultyCredits } = require('../utils/calculateCredits');
const { connectDB } = require('../config/db');
const { sendPushToUser } = require('./pushController');

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

    if (status === 'approved') {
      sendPushToUser(String(faculty._id), {
        title: 'Credit Approved',
        body: `Your credit submission "${updated.title}" has been approved.`,
        url: '/u/credits'
      });
    } else if (status === 'rejected') {
      sendPushToUser(String(faculty._id), {
        title: 'Credit Rejected',
        body: `Your credit submission "${updated.title}" was rejected.`,
        url: '/u/credits'
      });
    }

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

    // 6️⃣ Text search across multiple fields (optimized)
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(it => {
        const fields = [
          it.title,
          it.notes,
          it.facultySnapshot?.name,
          it.facultySnapshot?.facultyID,
          it.facultySnapshot?.college,
          it.facultySnapshot?.department,
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
    const formattedItems = paged.map(it => ({
      creditId: it._id,
      facultyName: it.facultySnapshot?.name || '',
      facultyID: it.facultySnapshot?.facultyID || '',
      college: it.facultySnapshot?.college || '',
      department: it.facultySnapshot?.department || '',
      templateTitle: it.creditTitle || '',
      title: it.title || '',
      type: it.type || '',
      points: it.points || 0,
      status: it.status || '',
      issuedBy: it.issuedBy || '',
      proofMeta: it.proofMeta || null,
      proofUrl: it.proofUrl || '',
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
      // Pass original raw fields as well
      ...it
    }));

    // 🔟 Extract distinct values for UI filters
    const distinctValues = {
      templates: [...new Set(items.map(i => i.creditTitle).filter(Boolean))].sort(),
      years: [...new Set(items.map(i => i.academicYear).filter(Boolean))].sort(),
      colleges: [...new Set(items.map(i => i.facultySnapshot?.college).filter(Boolean))].sort(),
      departments: [...new Set(items.map(i => i.facultySnapshot?.department).filter(Boolean))].sort()
    };

    // ✅ Response
    return res.json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      filters: distinctValues,
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
 * ADMIN: Get all negative credit appeals (Dynamo)
 * GET /api/v1/admin/credits/negative/appeals
 */
async function getNegativeAppeals(req, res, next) {
  try {
    await ensureDb();

    const {
      page = 1,
      limit = 20,
      academicYear = 'all',
      status = 'all', // main credit status
      appealStatus = 'all', // appeal status: pending/accepted/rejected
      facultyId,
      templateId = 'all',
      college = 'all',
      department = 'all',
      sort = '-appealDate',
      submittedFrom = '',
      submittedTo = '',
      search = ''
    } = req.query;

    // 1️⃣ Base filter for negative credits
    const baseFilter = { type: 'negative' };
    if (academicYear.toLowerCase() !== 'all') baseFilter.academicYear = academicYear.trim();
    if (facultyId) baseFilter.faculty = facultyId.trim();

    // 2️⃣ Fetch all credits
    let credits = await Credit.find(baseFilter);

    // 3️⃣ Filter to only those with appeals
    let items = credits.filter(
      c =>
        c.appeal &&
        ['pending', 'accepted', 'rejected'].includes(String(c.appeal.status || '').toLowerCase())
    );

    // 4️⃣ Filter by appeal status
    if (appealStatus.toLowerCase() !== 'all') {
      items = items.filter(
        c => String(c.appeal.status || '').toLowerCase() === appealStatus.toLowerCase()
      );
    }

    // 5️⃣ Filter by credit status
    if (status.toLowerCase() !== 'all') {
      const allowed = ['pending', 'approved', 'rejected', 'appealed'];
      if (!allowed.includes(status.toLowerCase())) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Allowed: ${allowed.join(', ')}`
        });
      }
      items = items.filter(c => String(c.status || '').toLowerCase() === status.toLowerCase());
    }

    // 6️⃣ Filter by template / credit title
    if (templateId.toLowerCase() !== 'all') {
      items = items.filter(c => String(c.creditTitle) === String(templateId));
    }

    // 7️⃣ Filter by college / department (from facultySnapshot)
    if (college.toLowerCase() !== 'all') {
      items = items.filter(
        c =>
          String(c.facultySnapshot?.college || '').toLowerCase() === college.toLowerCase()
      );
    }
    if (department.toLowerCase() !== 'all') {
      items = items.filter(
        c =>
          String(c.facultySnapshot?.department || '').toLowerCase() ===
          department.toLowerCase()
      );
    }

    // 8️⃣ Text search (faculty, title, notes)
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(c => {
        const fields = [
          c.title,
          c.notes,
          c.creditTitle,
          c.facultySnapshot?.name,
          c.facultySnapshot?.facultyID,
          c.appeal?.reason
        ];
        return fields.some(f => String(f || '').toLowerCase().includes(q));
      });
    }

    // 9️⃣ Sort
    const appealDate = c => c.appeal?.submittedAt || c.appeal?.createdAt || '';
    if (submittedFrom) {
      const from = Date.parse(`${submittedFrom}T00:00:00`);
      if (!Number.isFinite(from)) return res.status(400).json({ success: false, message: 'Invalid start date' });
      items = items.filter(c => {
        const date = Date.parse(appealDate(c));
        return Number.isFinite(date) && date >= from;
      });
    }
    if (submittedTo) {
      const to = Date.parse(`${submittedTo}T23:59:59.999`);
      if (!Number.isFinite(to)) return res.status(400).json({ success: false, message: 'Invalid end date' });
      items = items.filter(c => {
        const date = Date.parse(appealDate(c));
        return Number.isFinite(date) && date <= to;
      });
    }
    const desc = String(sort).startsWith('-');
    const sortKey = desc ? sort.slice(1) : sort;
    items.sort((a, b) => {
      const va = sortKey === 'appealDate' ? appealDate(a) : a[sortKey] || '';
      const vb = sortKey === 'appealDate' ? appealDate(b) : b[sortKey] || '';
      return desc
        ? String(vb).localeCompare(String(va))
        : String(va).localeCompare(String(vb));
    });

    // 🔟 Pagination
    const total = items.length;
    const skip = (Math.max(Number(page), 1) - 1) * Math.max(Number(limit), 1);
    const paged = items.slice(skip, skip + Math.max(Number(limit), 1));

    // 1️⃣1️⃣ Format data
    const formattedItems = paged.map(c => ({
      creditId: c._id,
      _id: c._id, // explicitly include credit _id for consistency
      title: c.title || '',
      notes: c.notes || '',
      creditTitle: c.creditTitle || '',
      type: c.type || '',
      points: c.points || 0,
      categories: c.categories || [],
      proofMeta: c.proofMeta || null,
      proofUrl: c.appeal?.proofUrl || c.proofUrl || '',
      creditProofUrl: c.proofUrl || '',
      appealProofUrl: c.appeal?.proofUrl || '',
      issuedBy: c.issuedBy || '',
      status: c.status || '',
      academicYear: c.academicYear || '',
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,

      // Faculty Info
      faculty: {
        name: c.facultySnapshot?.name || '',
        facultyID: c.facultySnapshot?.facultyID || '',
        college: c.facultySnapshot?.college || '',
        department: c.facultySnapshot?.department || '',
        email: c.facultySnapshot?.email || ''
      },

      // Appeal Info
      appeal: {
        status: c.appeal?.status || '',
        reason: c.appeal?.reason || '',
        submittedAt: appealDate(c),
        decisionNotes: c.appeal?.notes || '',
        response: c.appeal?.response || '',
        reviewedBy: c.appeal?.reviewedBy || '',
        updatedAt: c.appeal?.updatedAt || ''
      }
    }));

    // 1️⃣2️⃣ Build distinct dropdown values for frontend
    const distinctValues = {
      templates: [...new Set(credits.map(i => i.creditTitle).filter(Boolean))],
      years: [...new Set(credits.map(i => i.academicYear).filter(Boolean))],
      colleges: [...new Set(credits.map(i => i.facultySnapshot?.college).filter(Boolean))],
      departments: [...new Set(credits.map(i => i.facultySnapshot?.department).filter(Boolean))]
    };

    // ✅ Final response
    return res.json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      filters: distinctValues,
      items: formattedItems
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error', error: err.message });
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
    if (credit.type !== 'negative') return res.status(400).json({ success: false, message: 'Appeals can only change negative credits' });
    if (credit.status === 'deleted') return res.status(409).json({ success: false, message: 'A voided credit cannot have its appeal decided' });

    if (!credit.appeal || !credit.appeal.by) return res.status(400).json({ success: false, message: 'No appeal found for this credit' });
    if (credit.appeal.status !== 'pending') return res.status(409).json({ success: false, message: 'This appeal has already been decided' });

    let updated;
    try {
      updated = await Credit.decideAppeal(creditId, {
        decision: status,
        notes: typeof notes === 'string' ? notes.trim() : '',
        creditStatus: status === 'accepted' ? 'rejected' : 'approved',
        reviewedBy: req.user?._id,
      });
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        return res.status(409).json({ success: false, message: 'This appeal has already been decided' });
      }
      throw error;
    }
    let balanceUpdated = true;
    try {
      await recalcFacultyCredits(String(credit.faculty));
    } catch (error) {
      balanceUpdated = false;
      console.error('Appeal decided but faculty balance recalculation failed:', error);
    }

    // Emit socket event if needed
    emitSocket(req, 'credit:appeal:update', { creditId: updated._id, appeal: updated.appeal });

    if (status === 'accepted') {
      sendPushToUser(String(credit.faculty), {
        title: 'Appeal Accepted',
        body: `Your appeal for "${credit.title}" has been accepted.`,
        url: '/u/credits'
      });
    } else if (status === 'rejected') {
      sendPushToUser(String(credit.faculty), {
        title: 'Appeal Rejected',
        body: `Your appeal for "${credit.title}" was rejected.`,
        url: '/u/credits'
      });
    }

    return res.json({ success: true, balanceUpdated, data: updated });
  } catch (err) {
    next(err);
  }
}


/**
 * OA: Get credits issued by the logged-in OA user (advanced filters)
 * GET /oa/credits/issued
 *
 * Query params (all optional except page/limit):
 *  - type             : string or comma list (e.g. negative or negative,positive)
 *  - status           : string or comma list (e.g. pending,approved)
 *  - creditTitle      : id or title string (matches credit.creditTitle or credit.creditTitle._id)
 *  - faculty          : faculty id (credit.faculty) or comma list
 *  - academicYear     : string or comma list
 *  - categories       : comma list (matches any category in credit.categories)
 *  - minPoints        : number
 *  - maxPoints        : number
 *  - appealCountMin   : number
 *  - appealCountMax   : number
 *  - proofPresent     : boolean (true => proofUrl present)
 *  - search           : full text search across title, notes, creditTitle.title, facultySnapshot.name
 *  - createdFrom      : ISO date string
 *  - createdTo        : ISO date string
 *  - updatedFrom      : ISO date string
 *  - updatedTo        : ISO date string
 *  - sortBy           : createdAt | updatedAt | points | title (default: createdAt)
 *  - sortOrder        : asc | desc (default: desc)
 *  - limit            : number (default 25, max 200)
 *  - page             : number (default 1)
 *
 * NOTE: This implementation uses Credit.find(filter) (scan + basic filter) then applies all
 * additional filtering/sorting in-memory. For large datasets you should add a Dynamo GSI on
 * issuedBy (and other keys) and use QueryCommand.
 */
async function oaGetOwnIssuedCredits(req, res, next) {
  try {
    await ensureDb();
    const user = req.user;
    if (!user || !user._id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    // enforce OA role
    if (user.role !== 'oa') {
      return res.status(403).json({ success: false, message: 'Forbidden: OA role required' });
    }

    // Helper parsers
    const parseList = (val) => {
      if (val === undefined || val === null || val === '') return null;
      if (Array.isArray(val)) return val;
      return String(val).split(',').map(s => s.trim()).filter(Boolean);
    };
    const parseNumber = (v, fallback = null) => {
      if (v === undefined || v === null || v === '') return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const parseDate = (v) => {
      if (!v) return null;
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };
    const parseBool = (v) => {
      if (v === undefined || v === null) return null;
      if (typeof v === 'boolean') return v;
      const s = String(v).toLowerCase();
      if (['1', 'true', 'yes', 'y'].includes(s)) return true;
      if (['0', 'false', 'no', 'n'].includes(s)) return false;
      return null;
    };

    // Basic query params
    const {
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const limit = Math.min(Math.max(parseNumber(req.query.limit, 25), 1), 200);
    const page = Math.max(parseNumber(req.query.page, 1), 1);
    const offset = (page - 1) * limit;

    // Build base filter -> ensure issuedBy only (defense-in-depth). Pass minimal filter to model.find to reduce items returned.
    // The model.find does strict equality (c[k] === v), so pass issuedBy and maybe simple direct fields if present.
    const baseFilter = { issuedBy: user._id };

    // Quick pass-through for type/status/academicYear (these go to the DB scan filter)
    if (req.query.type && !String(req.query.type).includes(',') && req.query.type !== 'all') baseFilter.type = req.query.type;
    if (req.query.status && !String(req.query.status).includes(',') && req.query.status !== 'all') baseFilter.status = req.query.status;
    if (req.query.academicYear && !String(req.query.academicYear).includes(',') && req.query.academicYear !== 'all') baseFilter.academicYear = req.query.academicYear;

    // Fetch candidate set (this will scan then apply the simple baseFilter)
    const candidates = await Credit.find(baseFilter); // returns array

    // If no items, return early
    if (!candidates || candidates.length === 0) {
      return res.json({ success: true, data: { totalFiltered: 0, totalAvailable: 0, page, limit, items: [], aggregates: {}, filters: { years: [] } } });
    }

    // Prepare richer filters (in-memory)
    const types = parseList(req.query.type); // might be null
    const statuses = parseList(req.query.status);
    const creditTitleQ = req.query.creditTitle ? String(req.query.creditTitle).trim() : null;
    const faculties = parseList(req.query.faculty);
    const academicYears = parseList(req.query.academicYear);
    const categories = parseList(req.query.categories);
    const minPoints = parseNumber(req.query.minPoints, null);
    const maxPoints = parseNumber(req.query.maxPoints, null);
    const appealCountMin = parseNumber(req.query.appealCountMin, null);
    const appealCountMax = parseNumber(req.query.appealCountMax, null);
    const proofPresent = parseBool(req.query.proofPresent);
    const search = req.query.search ? String(req.query.search).trim().toLowerCase() : null;
    const createdFrom = parseDate(req.query.createdFrom);
    const createdTo = parseDate(req.query.createdTo);
    const updatedFrom = parseDate(req.query.updatedFrom);
    const updatedTo = parseDate(req.query.updatedTo);

    // Filtering function
    const matches = (c) => {
      // type (allow list)
      if (types && types.length && !types.includes(String(c.type))) return false;

      // status
      if (statuses && statuses.length && !statuses.includes(String(c.status))) return false;

      // creditTitle - try to match id or string title (case-insensitive)
      if (creditTitleQ) {
        const ct = c.creditTitle;
        const ctId = ct && (ct._id || ct); // could be id or object
        const ctTitle = (ct && ct.title) ? String(ct.title).toLowerCase() : null;
        if (ctId && String(ctId) === creditTitleQ) {
          // ok
        } else if (ctTitle && ctTitle.includes(creditTitleQ.toLowerCase())) {
          // ok
        } else {
          // not match
          return false;
        }
      }

      // faculty
      if (faculties && faculties.length) {
        if (!c.faculty || !faculties.includes(String(c.faculty))) return false;
      }

      // academicYear
      if (academicYears && academicYears.length) {
        if (!c.academicYear || !academicYears.includes(String(c.academicYear))) return false;
      }

      // categories: require any overlap between requested categories and credit.categories
      if (categories && categories.length) {
        const itemCats = Array.isArray(c.categories) ? c.categories.map(String) : [];
        const hasAny = categories.some(cat => itemCats.includes(cat));
        if (!hasAny) return false;
      }

      // points range
      if (minPoints !== null && (c.points === undefined || Number(c.points) < minPoints)) return false;
      if (maxPoints !== null && (c.points === undefined || Number(c.points) > maxPoints)) return false;

      // appealCount range
      if (appealCountMin !== null && (c.appealCount === undefined || Number(c.appealCount) < appealCountMin)) return false;
      if (appealCountMax !== null && (c.appealCount === undefined || Number(c.appealCount) > appealCountMax)) return false;

      // proof present boolean
      if (proofPresent !== null) {
        const hasProof = !!(c.proofUrl || (c.proofMeta && Object.keys(c.proofMeta || {}).length));
        if (proofPresent !== hasProof) return false;
      }

      // createdAt/updatedAt range (convert item strings to dates defensively)
      const createdAt = c.createdAt ? new Date(c.createdAt) : null;
      if (createdFrom && (!createdAt || createdAt < createdFrom)) return false;
      if (createdTo && (!createdAt || createdAt > createdTo)) return false;

      const updatedAt = c.updatedAt ? new Date(c.updatedAt) : null;
      if (updatedFrom && (!updatedAt || updatedAt < updatedFrom)) return false;
      if (updatedTo && (!updatedAt || updatedAt > updatedTo)) return false;

      // search: title, notes, creditTitle.title, facultySnapshot.name, issuedBySnapshot.name
      if (search) {
        const hay = [
          c.title,
          c.notes,
          (c.creditTitle && c.creditTitle.title) ? c.creditTitle.title : null,
          (c.facultySnapshot && c.facultySnapshot.name) ? c.facultySnapshot.name : null,
          (c.issuedBySnapshot && c.issuedBySnapshot.name) ? c.issuedBySnapshot.name : null,
        ]
          .filter(Boolean)
          .map(s => String(s).toLowerCase())
          .join(' | ');
        if (!hay.includes(search.toLowerCase())) return false;
      }

      return true;
    };

    // Apply filters
    const filtered = candidates.filter(matches);

    // Aggregates (simple counts by type and status) - helpful for frontend faceted UI
    const aggregates = {
      total: filtered.length,
      byType: {},
      byStatus: {},
    };
    for (const it of filtered) {
      const t = it.type || 'unknown';
      const s = it.status || 'unknown';
      aggregates.byType[t] = (aggregates.byType[t] || 0) + 1;
      aggregates.byStatus[s] = (aggregates.byStatus[s] || 0) + 1;
    }

    // Sorting
    const compare = (a, b) => {
      let av, bv;
      switch (sortBy) {
        case 'updatedAt':
          av = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          bv = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          break;
        case 'points':
          av = Number(a.points || 0);
          bv = Number(b.points || 0);
          break;
        case 'title':
          av = a.title ? String(a.title).toLowerCase() : '';
          bv = b.title ? String(b.title).toLowerCase() : '';
          break;
        case 'createdAt':
        default:
          av = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          bv = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      }

      if (av < bv) return sortOrder === 'asc' ? -1 : 1;
      if (av > bv) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    };

    const sorted = filtered.sort(compare);

    // Pagination slice
    const pagedItems = sorted.slice(offset, offset + limit);

    // Optionally: ensure issuedBySnapshot present (cheap enrichment)
    const itemsWithSnapshot = await Promise.all(pagedItems.map(async (c) => {
      if (c.issuedBySnapshot && c.issuedBySnapshot.name) return c;
      if (c.issuedBy) {
        // Avoid throwing if User.findById fails; model.findById uses Dynamo's GetCommand
        try {
          const u = await User.findById(c.issuedBy);
          if (u) {
            return { ...c, issuedBySnapshot: { _id: u._id, name: u.name, email: u.email } };
          }
        } catch (e) {
          // ignore enrichment errors
          return c;
        }
      }
      return c;
    }));

    return res.json({
      success: true,
      data: {
        totalFiltered: aggregates.total,
        totalAvailable: candidates.length, // how many candidates fetched from scan+baseFilter
        page,
        limit,
        items: itemsWithSnapshot,
        filters: { years: [...new Set(candidates.map(item => item.academicYear).filter(Boolean))].sort().reverse() },
        aggregates, // byType and byStatus
      },
    });
  } catch (err) {
    next(err);
  }
}


// Optional email queue helper (bulkRegister used createEmailQueue). We attempt to require it but degrade gracefully.
let createEmailQueue = null;
try {
  createEmailQueue = require('../utils/emailQueue').createEmailQueue;
} catch (e) {
  createEmailQueue = null;
}


/**
 * Admin/OA re-opens the appeal window for a negative credit
 * PATCH /api/v1/admin/credits/negative/:creditId/reopen
 */
async function adminReopenAppealWindow(req, res, next) {
  try {
    const { creditId } = req.params;
    if (!creditId) return res.status(400).json({ success: false, message: 'creditId required' });

    await ensureDb();
    const credit = await Credit.findById(creditId);
    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });
    if (credit.status === 'deleted') return res.status(409).json({ success: false, message: 'Voided credits cannot be changed' });
    if (req.user.role === 'oa' && String(credit.issuedBy) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You can manage only credits you issued' });
    }
    if (credit.type !== 'negative') {
      return res.status(400).json({ success: false, message: 'Only negative credits can have appeals re-opened' });
    }

    const updates = {
      overrideAppealWindow: true,
      updatedAt: new Date().toISOString()
    };

    // Reset attempt count if it was at the limit
    if ((credit.appealCount || 0) >= 2) {
      updates.appealCount = 0;
    }

    await Credit.update(creditId, updates);
    const updated = await Credit.findById(creditId);

    emitSocket(req, 'credit:appeal:reopened', { creditId, facultyId: updated.faculty });

    return res.json({ 
      success: true, 
      message: 'Appeal window has been re-opened for this faculty member.', 
      data: updated 
    });
  } catch (err) {
    next(err);
  }
}


module.exports = {
  updatePositiveCreditStatus,
  getPositiveCreditById,
  listNegativeCreditsForFaculty,
  adminListNegativeCredits,
  adminGetNegativeCreditById,
  adminGetFacultyByNegativeCreditId,
  adminListNegativeCreditAppeals,
  adminGetAppealByCreditId,
  adminUpdateAppealStatus,
  getNegativeAppeals,
  oaGetOwnIssuedCredits,
  adminReopenAppealWindow,
};

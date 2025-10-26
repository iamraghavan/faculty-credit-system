const mongoose = require('mongoose');
const CreditTitle = require('../Models/CreditTitle');
const Credit = require('../Models/Credit');
const User = require('../Models/User');
const fs = require('fs');
const path = require('path');

const { recalcFacultyCredits } = require('../utils/calculateCredits');

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
 * Admin creates credit title
 */
async function createCreditTitle(req, res, next) {
  try {
    const actor = req.user;
    const { title, points, type, description } = req.body;
    if (!title || !points) return res.status(400).json({ success: false, message: 'Title and points required' });

    const ct = await CreditTitle.create({ title, points, type: type || 'positive', description, createdBy: actor._id });

    res.status(201).json({ success: true, data: ct });
  } catch (err) {
    next(err);
  }
}

async function listCreditTitles(req, res, next) {
  try {
    const items = await CreditTitle.find({ isActive: true });
    res.json({ success: true, total: items.length, items });
  } catch (err) {
    next(err);
  }
}

async function updateCreditTitle(req, res, next) {
  try {
    const { id } = req.params;
    const { title, points, type, description } = req.body;

    const updated = await CreditTitle.findByIdAndUpdate(id, { title, points, type, description }, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ success: false, message: 'Credit title not found' });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

async function deleteCreditTitle(req, res, next) {
  try {
    const { id } = req.params;
    const deleted = await CreditTitle.findByIdAndUpdate(id, { isActive: false }, { new: true });
    if (!deleted) return res.status(404).json({ success: false, message: 'Credit title not found' });

    res.json({ success: true, message: 'Credit title deactivated', data: deleted });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin issues negative credit to faculty
 * POST body: { facultyId, creditTitleId, title, points, notes, academicYear }
 */
async function issueNegativeCredit(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const admin = req.user;
    const { facultyId, creditTitleId, title, points, notes, academicYear } = req.body;

    if (!facultyId || !points || !academicYear) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const faculty = await User.findById(facultyId).session(session);
    if (!faculty) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Faculty not found' });
    }

    const creditTitle = creditTitleId ? await CreditTitle.findById(creditTitleId).session(session) : null;

    const credit = new Credit({
      faculty: faculty._id,
      facultySnapshot: { name: faculty.name, facultyID: faculty.facultyID, college: faculty.college, department: faculty.department },
      type: 'negative',
      creditTitle: creditTitle?._id,
      title: title || creditTitle?.title,
      points,
      notes,
      academicYear,
      issuedBy: admin._id,
      proofUrl: req.file ? `/uploads/${req.file.filename}` : undefined,
      proofMeta: req.file ? { originalName: req.file.originalname, size: req.file.size, mimeType: req.file.mimetype } : undefined
    });

    await credit.save({ session });
    await session.commitTransaction();
    session.endSession();

    // Emit real-time notification to frontend
    emitSocket(req, 'credit:negative:new', { facultyId, credit });

    res.status(201).json({ success: true, data: credit });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
}

/**
 * List negative credits for a specific faculty
 */
async function listNegativeCreditsForFaculty(req, res, next) {
  try {
    const { facultyId } = req.params;
    if (req.user.role !== 'faculty' && req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

    if (req.user.role === 'faculty' && req.user._id.toString() !== facultyId) {
      return res.status(403).json({ success: false, message: 'Cannot view other faculty credits' });
    }

    const credits = await Credit.find({ faculty: facultyId, type: 'negative' })
      .sort('-createdAt')
      .populate('issuedBy', 'name email role')
      .populate('creditTitle', 'title points');

    res.json({ success: true, total: credits.length, items: credits });
  } catch (err) {
    next(err);
  }
}

/**
 * Positive credits listing for admin (already optimized)
 */
async function listPositiveCreditsForAdmin(req, res, next) {
  try {
    const { status, facultyId, academicYear, fromDate, toDate, page = 1, limit = 20, sort = '-createdAt', search } = req.query;

    const filter = { type: 'positive' };
    if (status) filter.status = { $in: status.split(',') };
    if (facultyId) filter.faculty = facultyId;
    if (academicYear) filter.academicYear = academicYear;
    if (fromDate || toDate) filter.createdAt = { ...(fromDate && { $gte: new Date(fromDate) }), ...(toDate && { $lte: new Date(toDate) }) };
    if (search) filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { notes: { $regex: search, $options: 'i' } },
      { 'facultySnapshot.name': { $regex: search, $options: 'i' } },
      { 'facultySnapshot.facultyID': { $regex: search, $options: 'i' } }
    ];

    const skip = (page - 1) * limit;
    const [total, items] = await Promise.all([
      Credit.countDocuments(filter),
      Credit.find(filter)
        .populate('faculty', 'name facultyID email college department')
        .populate('creditTitle', 'title points type')
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
    ]);

    res.json({ success: true, total, page: Number(page), limit: Number(limit), items });
  } catch (err) {
    next(err);
  }
}

/**
 * Positive credit update status
 */
async function updatePositiveCreditStatus(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const allowed = ['pending', 'approved', 'rejected', 'appealed'];
    if (!allowed.includes(status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const credit = await Credit.findById(id).session(session);
    if (!credit) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: 'Credit not found' });
    }

    if (credit.type !== 'positive') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: 'Not a positive credit' });
    }

    // Load faculty inside transaction to ensure it exists (we won't update it here)
    const faculty = await User.findById(credit.faculty).session(session);
    if (!faculty) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: 'Faculty not found' });
    }

    const prevStatus = credit.status;

    // Only update credit document inside the transaction
    credit.status = status;
    if (typeof notes !== 'undefined') credit.notes = notes;

    await credit.save({ session });

    // commit transaction: the credit status change is now durable
    await session.commitTransaction();
    session.endSession();

    // Recalculate faculty totals after the credit status change.
    // recalcFacultyCredits reads Credit collection and writes User doc.
    // It is executed outside the transaction (so it sees committed changes).
    try {
      await recalcFacultyCredits(faculty._id);
    } catch (recalcErr) {
      // Log the error but continue — credit status has been changed; totals can be retried.
      console.error('recalcFacultyCredits failed:', recalcErr);
    }

    // Emit socket update (ensure emitSocket or io is available in this module)
    emitSocket(req, 'credit:positive:update', { credit });

    return res.json({ success: true, data: credit });
  } catch (err) {
    // Ensure transaction is aborted on error
    try { await session.abortTransaction(); } catch (e) { /* ignore */ }
    session.endSession();
    next(err);
  }
}

async function getPositiveCreditById(req, res, next) {
  try {
    const { id } = req.params;
    const credit = await Credit.findById(id).populate('faculty', 'name facultyID email college department currentCredit creditsByYear').populate('creditTitle', 'title points type');
    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });
    if (credit.type !== 'positive') return res.status(400).json({ success: false, message: 'Not a positive credit' });
    res.json({ success: true, data: credit });
  } catch (err) {
    next(err);
  }
}


/**
 * ADMIN: List all negative credits (paginated + filters)
 * GET /api/v1/admin/credits/negative
 * Query: page, limit, academicYear, status, facultyId, sort, search
 */
async function adminListNegativeCredits(req, res, next) {
  try {
    const {
      page = 1,
      limit = 20,
      academicYear,
      status,
      facultyId,
      sort = '-createdAt',
      search
    } = req.query;

    const filter = { type: 'negative' };

    if (academicYear && String(academicYear).trim().toLowerCase() !== 'all') {
      filter.academicYear = String(academicYear).trim();
    }

    if (status && String(status).trim().toLowerCase() !== 'all') {
      const s = String(status).trim().toLowerCase();
      const allowed = ['pending', 'approved', 'rejected', 'appealed'];
      if (!allowed.includes(s)) {
        return res.status(400).json({ success: false, message: `Invalid status. Allowed: ${allowed.join(', ')}` });
      }
      filter.status = s;
    }

    if (facultyId) {
      if (!mongoose.isValidObjectId(facultyId)) {
        return res.status(400).json({ success: false, message: 'Invalid facultyId' });
      }
      filter.faculty = facultyId;
    }

    if (search) {
      const q = String(search).trim();
      filter.$or = [
        { title: { $regex: q, $options: 'i' } },
        { notes: { $regex: q, $options: 'i' } },
        { 'facultySnapshot.name': { $regex: q, $options: 'i' } },
        { 'facultySnapshot.facultyID': { $regex: q, $options: 'i' } }
      ];
    }

    const skip = (Math.max(Number(page), 1) - 1) * Math.max(Number(limit), 1);

    const [total, items] = await Promise.all([
      Credit.countDocuments(filter),
      Credit.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(Math.max(Number(limit), 1))
        .populate('faculty', 'name facultyID email college department')
        .populate('issuedBy', 'name email role')
        .populate('creditTitle', 'title points type')
        .lean()
    ]);

    return res.json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      items
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * ADMIN: Get a single negative credit by id
 * GET /api/v1/admin/credits/negative/:id
 */
async function adminGetNegativeCreditById(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid credit id' });
    }

    const credit = await Credit.findById(id)
      .populate('faculty', 'name facultyID email college department')
      .populate('issuedBy', 'name email role')
      .populate('creditTitle', 'title points type')
      .lean();

    if (!credit) {
      return res.status(404).json({ success: false, message: 'Negative credit not found' });
    }

    if (credit.type !== 'negative') {
      return res.status(400).json({ success: false, message: 'Credit is not negative' });
    }

    return res.json({ success: true, data: credit });
  } catch (err) {
    return next(err);
  }
}

/**
 * ADMIN: Get faculty (id and basic info) by negative credit id
 * GET /api/v1/admin/credits/negative/:id/faculty
 */
async function adminGetFacultyByNegativeCreditId(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid credit id' });
    }

    const credit = await Credit.findById(id).select('faculty facultySnapshot type').lean();
    if (!credit) {
      return res.status(404).json({ success: false, message: 'Negative credit not found' });
    }

    if (credit.type && credit.type !== 'negative') {
      return res.status(400).json({ success: false, message: 'Not a negative credit' });
    }

    // Try to return faculty snapshot first; fall back to User document lookup if needed
    let facultyInfo = credit.facultySnapshot || null;
    if (!facultyInfo || !facultyInfo.name) {
      if (credit.faculty && mongoose.isValidObjectId(credit.faculty)) {
        const user = await User.findById(credit.faculty).select('name facultyID email college department').lean();
        facultyInfo = user || null;
      }
    }

    return res.json({ success: true, data: { facultyId: credit.faculty, faculty: facultyInfo } });
  } catch (err) {
    return next(err);
  }
}

async function adminListNegativeCreditAppeals(req, res, next) {
  try {
    const { page = 1, limit = 20, status, facultyId, academicYear, sort = '-appeal.createdAt' } = req.query;

    const filter = { type: 'negative', 'appeal.by': { $exists: true } };
    if (status) filter['appeal.status'] = status;
    if (facultyId && mongoose.isValidObjectId(facultyId)) filter.faculty = facultyId;
    if (academicYear && academicYear.toLowerCase() !== 'all') filter.academicYear = academicYear;

    const skip = (Math.max(Number(page), 1) - 1) * Math.max(Number(limit), 1);

    const [total, items] = await Promise.all([
      Credit.countDocuments(filter),
      Credit.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
        .populate('faculty', 'name facultyID email college department')
        .populate('issuedBy', 'name email role')
        .populate('appeal.by', 'name facultyID email')
        .lean(),
    ]);

    res.json({ success: true, total, page: Number(page), limit: Number(limit), items });
  } catch (err) {
    console.error('adminListNegativeCreditAppeals error:', err);
    next(err);
  }
}


async function getNegativeAppeals(req, res) {
  try {
    // Fetch all credits where the type is 'negative' and appeal status is 'pending', 'accepted', or 'rejected'
    const negativeAppeals = await Credit.find({
      type: 'negative',
      'appeal.status': { $in: ['pending', 'accepted', 'rejected'] }
    }).populate('faculty', 'name college department') // Populating faculty info to show relevant details
      .populate('appeal.by', 'name email') // Populating appeal's user info
      .select('faculty title points categories proofUrl appeal status createdAt');

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
 * Admin: Get a single appeal by negative credit ID
 * GET /api/v1/admin/credits/negative/:creditId/appeal
 */
async function adminGetAppealByCreditId(req, res, next) {
  try {
    const { creditId } = req.params;
    if (!mongoose.isValidObjectId(creditId)) return res.status(400).json({ success: false, message: 'Invalid creditId' });

    const credit = await Credit.findById(creditId)
      .populate('faculty', 'name facultyID email college department')
      .populate('issuedBy', 'name email role')
      .populate('appeal.by', 'name facultyID email')
      .lean();

    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });
    if (!credit.appeal || !credit.appeal.by) return res.status(404).json({ success: false, message: 'No appeal found for this credit' });

    return res.json({ success: true, data: credit.appeal });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: Update appeal status
 * PUT /api/v1/admin/credits/negative/:creditId/appeal
 * Body: { status: 'accepted' | 'rejected', notes: optional }
 */
async function adminUpdateAppealStatus(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { creditId } = req.params;
    const { status, notes } = req.body;

    const allowedStatuses = ['accepted', 'rejected'];
    if (!allowedStatuses.includes(status)) return res.status(400).json({ success: false, message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}` });

    const credit = await Credit.findById(creditId).session(session);
    if (!credit) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Credit not found' });
    }
    if (!credit.appeal || !credit.appeal.by) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'No appeal found for this credit' });
    }

    credit.appeal.status = status;
    credit.notes = notes || credit.notes;

    // Optional: If appeal accepted, mark credit as pending re-review
    if (status === 'accepted' && credit.status !== 'pending') {
      credit.status = 'pending';
    }

    await credit.save({ session });
    await session.commitTransaction();
    session.endSession();

    // Emit socket event if needed
    const io = req.app?.locals?.io;
    if (io) io.emit('credit:appeal:update', { creditId: credit._id, appeal: credit.appeal });

    return res.json({ success: true, data: credit });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
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
  getNegativeAppeals
};

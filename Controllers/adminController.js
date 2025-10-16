const CreditTitle = require('../Models/CreditTitle');
const mongoose = require('mongoose');
const Credit = require('../Models/Credit');
const User = require('../Models/User');

async function createCreditTitle(req, res, next) {

  try {
    const actor = req.user;
    if (!actor || actor.role !== 'admin') 
      return res.status(403).json({ success: false, message: 'Forbidden' });


    const { title, points, type, description } = req.body;
    if (!title || !points) 
      return res.status(400).json({ success: false, message: 'Missing required fields' });

    const ct = await CreditTitle.create({
      title,
      points,
      type: type || 'positive',
      description,
      createdBy: actor._id,
    });

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

// Update credit title
async function updateCreditTitle(req, res, next) {
  try {
    const actor = req.user;
    if (!actor || actor.role !== 'admin') 
      return res.status(403).json({ success: false, message: 'Forbidden' });

    const { id } = req.params;
    const { title, points, type, description } = req.body;

    const updated = await CreditTitle.findByIdAndUpdate(
      id,
      { title, points, type, description },
      { new: true, runValidators: true }
    );

    if (!updated)
      return res.status(404).json({ success: false, message: 'Credit title not found' });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

// Delete (soft delete) credit title.
async function deleteCreditTitle(req, res, next) {
  try {
    const actor = req.user;
    if (!actor || actor.role !== 'admin')
      return res.status(403).json({ success: false, message: 'Forbidden' });

    const { id } = req.params;

    // soft delete by marking isActive = false
    const deleted = await CreditTitle.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );

    if (!deleted)
      return res.status(404).json({ success: false, message: 'Credit title not found' });

    res.json({ success: true, message: 'Credit title deactivated', data: deleted });
  } catch (err) {
    next(err);
  }
}

/**
 * List positive credits for admin with flexible filters
 * Query params supported:
 *   status (comma separated or single) -> pending,approved,rejected,appealed
 *   facultyId
 *   academicYear
 *   fromDate, toDate (ISO dates) -> filter createdAt
 *   page, limit, sort (e.g. createdAt,-createdAt, points)
 */
async function listPositiveCreditsForAdmin(req, res, next) {
  try {
    // admin already validated by middleware
    const {
      status,
      facultyId,
      academicYear,
      fromDate,
      toDate,
      page = 1,
      limit = 20,
      sort = '-createdAt',
      search // optional text search on title/notes
    } = req.query;

    const filter = { type: 'positive' };

    // status may be comma-separated
    if (status) {
      const statuses = String(status).split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length) filter.status = { $in: statuses };
    }

    if (facultyId) filter.faculty = facultyId;
    if (academicYear) filter.academicYear = academicYear;

    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = new Date(fromDate);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }

    if (search) {
      const q = search.trim();
      filter.$or = [
        { title: { $regex: q, $options: 'i' } },
        { notes: { $regex: q, $options: 'i' } },
        { 'facultySnapshot.name': { $regex: q, $options: 'i' } },
        { 'facultySnapshot.facultyID': { $regex: q, $options: 'i' } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [total, items] = await Promise.all([
      Credit.countDocuments(filter),
      Credit.find(filter)
        .populate('faculty', 'name facultyID email college department') // small faculty info
        .populate('creditTitle', 'title points type')
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
    ]);

    return res.json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      items
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get single positive credit by id
 */
async function getPositiveCreditById(req, res, next) {
  try {
    const { id } = req.params;
    const credit = await Credit.findById(id)
      .populate('faculty', 'name facultyID email college department currentCredit creditsByYear')
      .populate('creditTitle', 'title points type');

    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });
    if (credit.type !== 'positive') return res.status(400).json({ success: false, message: 'Not a positive credit' });

    res.json({ success: true, data: credit });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin updates the status of a positive credit.
 * Body: { status: 'approved'|'rejected'|'pending'|'appealed', notes?: string }
 *
 * Important behavior:
 * - If changing to 'approved' and the credit was NOT already approved, add the credit points to the faculty's currentCredit and creditsByYear.
 * - If changing FROM 'approved' to any other status, subtract the credit points from the faculty's currentCredit and creditsByYear (rollback).
 * - Operation is performed inside a transaction for consistency.
 */
async function updatePositiveCreditStatus(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const admin = req.user;
    if (!admin || admin.role !== 'admin') {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const { id } = req.params;
    const { status, notes } = req.body;
    const allowed = ['pending', 'approved', 'rejected', 'appealed'];

    if (!status || !allowed.includes(status)) {
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
      return res.status(400).json({ success: false, message: 'This endpoint is for positive credits only' });
    }

    const faculty = await User.findById(credit.faculty).session(session);
    if (!faculty) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: 'Faculty user not found' });
    }

    const prevStatus = credit.status;
    const points = Number(credit.points) || 0;
    let userChanged = false;

    // If moving to approved and was not approved before -> add points
    if (status === 'approved' && prevStatus !== 'approved') {
      // add points
      faculty.currentCredit = Number(faculty.currentCredit || 0) + points;

      if (faculty.creditsByYear && typeof faculty.creditsByYear.set === 'function') {
        const prev = Number(faculty.creditsByYear.get(credit.academicYear) || 0);
        faculty.creditsByYear.set(credit.academicYear, prev + points);
      } else {
        faculty.creditsByYear = faculty.creditsByYear || {};
        const prev = Number(faculty.creditsByYear[credit.academicYear] || 0);
        faculty.creditsByYear[credit.academicYear] = prev + points;
      }
      userChanged = true;
    }

    // If previously approved and now moving away from approved -> rollback subtract points
    if (prevStatus === 'approved' && status !== 'approved') {
      faculty.currentCredit = Number(faculty.currentCredit || 0) - points;

      if (faculty.creditsByYear && typeof faculty.creditsByYear.set === 'function') {
        const prev = Number(faculty.creditsByYear.get(credit.academicYear) || 0);
        faculty.creditsByYear.set(credit.academicYear, prev - points);
      } else {
        faculty.creditsByYear = faculty.creditsByYear || {};
        const prev = Number(faculty.creditsByYear[credit.academicYear] || 0);
        faculty.creditsByYear[credit.academicYear] = prev - points;
      }
      userChanged = true;
    }

    // Update credit fields
    credit.status = status;
    if (notes) credit.notes = String(notes);
    // If admin marks 'appealed', keep appeal object? We leave appeal handling separate.
    await credit.save({ session });

    if (userChanged) {
      await faculty.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    // Return updated credit (populate small fields)
    const updated = await Credit.findById(id)
      .populate('faculty', 'name facultyID email college department currentCredit creditsByYear')
      .populate('creditTitle', 'title points type');

    return res.json({ success: true, data: updated });
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch (e) {}
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
  getPositiveCreditById
};

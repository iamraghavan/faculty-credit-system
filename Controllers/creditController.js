const Credit = require('../Models/Credit');
const User = require('../Models/User');
const CreditTitle = require('../Models/CreditTitle');
const { uploadFileToGitHub } = require('../utils/githubUpload');
const fs = require('fs');
const path = require('path');
const { sendEmail } = require('../utils/email');
const mongoose = require('mongoose');
const io = require('../socket'); // import socket instance

/**
 * Helper: handle file upload and return proofUrl & proofMeta
 */
async function handleFileUpload(file, academicYear) {
  if (!file) return {};

  const tmpPath = file.path;
  const destPath = `assets/${academicYear}/${Date.now()}_${file.originalname}`;
  let proofUrl;

  if (process.env.GITHUB_TOKEN && process.env.ASSET_GH_REPO && process.env.ASSET_GH_OWNER) {
    try { proofUrl = await uploadFileToGitHub(tmpPath, destPath); } 
    catch { proofUrl = `/uploads/${path.basename(tmpPath)}`; }
  } else {
    proofUrl = `/uploads/${path.basename(tmpPath)}`;
  }

  try { fs.unlinkSync(tmpPath); } catch {}

  return { proofUrl, proofMeta: { originalName: file.originalname, size: file.size, mimeType: file.mimetype } };
}

/**
 * Faculty submits positive credit
 */
async function submitPositiveCredit(req, res, next) {
  try {
    const faculty = req.user;
    if (!faculty || faculty.role !== 'faculty') return res.status(403).json({ success: false, message: 'Forbidden' });

    let { title, points, categories, academicYear, notes } = req.body;
    if (!title || !points || !academicYear) return res.status(400).json({ success: false, message: 'Missing required fields' });

    points = Number(points);
    if (points <= 0 || isNaN(points)) return res.status(400).json({ success: false, message: 'Points must be a positive number' });

    // Validate category IDs
    let categoryIds = [];
    if (categories) {
      if (!Array.isArray(categories)) categories = String(categories).split(',');
      categoryIds = categories.map(c => c.trim()).filter(Boolean);
      const validCategories = await CreditTitle.find({ _id: { $in: categoryIds } }).select('_id');
      const validIds = validCategories.map(c => c._id.toString());
      const invalidIds = categoryIds.filter(c => !validIds.includes(c));
      if (invalidIds.length > 0) return res.status(400).json({ success: false, message: 'Invalid category IDs', invalidIds });
      categoryIds = validCategories.map(c => c._id);
    }

    const { proofUrl, proofMeta } = await handleFileUpload(req.file, academicYear);

    const creditDoc = await Credit.create({
      faculty: faculty._id,
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
      issuedBy: faculty._id,
      status: 'pending',
      notes: notes || undefined
    });

    // Update faculty credits
    faculty.currentCredit = (faculty.currentCredit || 0) + points;
    faculty.creditsByYear = faculty.creditsByYear || {};
    faculty.creditsByYear[academicYear] = (faculty.creditsByYear[academicYear] || 0) + points;
    await faculty.save();

    // Emit socket update
    io.emit(`faculty:${faculty._id}:creditUpdate`, creditDoc);

    res.status(201).json({ success: true, data: creditDoc });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin issues negative credit
 */
async function adminIssueNegativeCredit(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const actor = req.user;
    const { facultyId, creditTitleId, academicYear, notes } = req.body;

    if (!facultyId || !creditTitleId || !academicYear)
      return res.status(400).json({ success: false, message: 'Missing required fields' });

    const faculty = await User.findById(facultyId).session(session);
    if (!faculty) return res.status(404).json({ success: false, message: 'Faculty not found' });

    const ct = await CreditTitle.findById(creditTitleId).session(session);
    if (!ct || ct.type !== 'negative') return res.status(400).json({ success: false, message: 'Invalid negative credit title' });

    const { proofUrl, proofMeta } = await handleFileUpload(req.file, academicYear);

    const c = await Credit.create([{
      faculty: faculty._id,
      facultySnapshot: { facultyID: faculty.facultyID, name: faculty.name, college: faculty.college },
      type: 'negative',
      title: ct.title,
      points: -Math.abs(ct.points),
      proofUrl,
      proofMeta,
      academicYear,
      issuedBy: actor._id,
      status: 'pending',
      notes
    }], { session });

    faculty.currentCredit = (faculty.currentCredit || 0) - Math.abs(ct.points);
    faculty.creditsByYear = faculty.creditsByYear || {};
    faculty.creditsByYear[academicYear] = (faculty.creditsByYear[academicYear] || 0) - Math.abs(ct.points);
    await faculty.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Emit socket update
    io.emit(`faculty:${faculty._id}:creditUpdate`, c[0]);

    // Email notification (async)
    sendEmail({
      to: faculty.email,
      subject: `Negative Credit Issued: ${ct.title}`,
      text: `A negative credit (${ct.points}) has been issued against you for ${academicYear}. Reason: ${notes || 'Not provided'}`
    }).catch(() => {});

    res.status(201).json({ success: true, data: c[0] });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    next(err);
  }
}

/**
 * Faculty appeals negative credit
 */
async function appealNegativeCredit(req, res, next) {
  try {
    const actor = req.user;
    const { creditId, reason } = req.body;

    if (!reason) return res.status(400).json({ success: false, message: 'Appeal reason required' });

    const credit = await Credit.findById(creditId);
    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });
    if (credit.type !== 'negative') return res.status(400).json({ success: false, message: 'Only negative credits can be appealed' });
    if (String(credit.faculty) !== String(actor._id) && actor.role !== 'admin') return res.status(403).json({ success: false, message: 'Unauthorized' });

    credit.appeal = { by: actor._id, reason, createdAt: new Date(), status: 'pending' };
    credit.status = 'appealed';
    await credit.save();

    io.emit(`admin:appealNotification`, credit);

    res.json({ success: true, data: credit });
  } catch (err) {
    next(err);
  }
}

/**
 * List credits for faculty (frontend-friendly)
 */
async function listCreditsForFaculty(req, res, next) {
  try {
    const { facultyId } = req.params;
    const { page = 1, limit = 20, academicYear } = req.query;

    const filter = { faculty: facultyId };
    if (academicYear) filter.academicYear = academicYear;

    const skip = (Number(page) - 1) * Number(limit);
    const [total, items] = await Promise.all([
      Credit.countDocuments(filter),
      Credit.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit))
    ]);

    res.json({ success: true, total, page: Number(page), limit: Number(limit), items });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin creates credit title
 */
async function createCreditTitle(req, res, next) {
  try {
    const actor = req.user;
    const { title, points, type, description } = req.body;
    if (!title || !points) return res.status(400).json({ success: false, message: 'Title and points are required' });

    const ct = await CreditTitle.create({ title, points, type: type || 'positive', description, createdBy: actor._id });
    res.status(201).json({ success: true, data: ct });
  } catch (err) { next(err); }
}

/**
 * List credit titles
 */
async function listCreditTitles(req, res, next) {
  try {
    const items = await CreditTitle.find({ isActive: true });
    res.json({ success: true, total: items.length, items });
  } catch (err) { next(err); }
}

module.exports = {
  submitPositiveCredit,
  appealNegativeCredit,
  listCreditsForFaculty,
  adminIssueNegativeCredit,
  createCreditTitle,
  listCreditTitles
};

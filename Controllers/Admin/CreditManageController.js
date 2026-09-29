const Credit = require('../../Models/Credit');
const CreditTitle = require('../../Models/CreditTitle');
const User = require('../../Models/User');
const { connectDB } = require('../../config/db');
const { recalcFacultyCredits } = require('../../utils/calculateCredits');
const { handleFileUpload } = require('../../utils/fileUpload');
const { schemas } = require('../../utils/validation');
const fs = require('fs');
const path = require('path');
const { sendPushToUser } = require('../pushController');



/**
 * Admin issues negative credit to faculty (Dynamo)
 */
async function issueNegativeCredit(req, res, next) {
  try {
    await connectDB();

    const { error, value } = schemas.issueCredit.negative.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const admin = req.user;
    const { facultyId, creditTitleId, title, points, notes, academicYear } = value;

    // faculty lookup
    const faculty = await User.findById(facultyId);
    if (!faculty) return res.status(404).json({ success: false, message: 'Faculty not found' });
    if (faculty.role !== 'faculty' || faculty.isActive === false) return res.status(400).json({ success: false, message: 'Select an active faculty account' });

    // credit title lookup
    let creditTitle = null;
    if (creditTitleId) {
      creditTitle = await CreditTitle.findById(creditTitleId);
      if (!creditTitle) return res.status(404).json({ success: false, message: 'Credit title not found' });
      if (creditTitle.type !== 'negative' || creditTitle.isActive === false) return res.status(400).json({ success: false, message: 'Select an active negative credit title' });
    }
    if (!creditTitle) return res.status(400).json({ success: false, message: 'Negative credits require a credit title' });
    const negativePoints = Math.abs(Number(creditTitle.points));
    const maxPoints = Math.max(1, Number(process.env.MAX_ISSUED_CREDIT_POINTS) || 10000);
    if (!Number.isFinite(negativePoints) || negativePoints <= 0 || negativePoints > maxPoints) return res.status(400).json({ success: false, message: 'Credit title points are invalid' });

    // File upload
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
      title: creditTitle.title,
      points: -negativePoints,
      notes,
      academicYear,
      issuedBy: String(admin._id),
      proofUrl,
      proofMeta,
      status: 'pending',
    });

    // Recalc
    try { await recalcFacultyCredits(faculty._id); } catch (e) { console.error(e); }

    // Socket emit
    // Assuming 'io' is attached to app.locals or req
    const io = req.app?.locals?.io;
    if (io) io.emit('credit:negative:new', { facultyId: String(faculty._id), credit: creditItem });

    // 2. Send Push Notification
    sendPushToUser(String(faculty._id), {
      title: 'Alert: Negative Credit Received',
      body: `A negative credit of ${Math.abs(creditItem.points)} has been issued: ${creditItem.title}.`,
      url: '/u/credits',
      icon: '/icons/warning.png'
    });

    return res.status(201).json({ success: true, data: creditItem });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin/OA issues positive credit to faculty (Direct Award)
 */
async function issuePositiveCredit(req, res, next) {
  try {
    await connectDB();

    // Use validation if available, else manual check
    const { facultyId, creditTitleId, title, points, notes, academicYear } = req.body;

    if (!facultyId || !academicYear || (!points && points !== 0 && !creditTitleId)) {
      return res.status(400).json({ success: false, message: 'Missing required fields (facultyId, academicYear, and points/creditTitleId)' });
    }

    // faculty lookup
    const faculty = await User.findById(facultyId);
    if (!faculty) return res.status(404).json({ success: false, message: 'Faculty not found' });
    if (faculty.role !== 'faculty' || faculty.isActive === false) return res.status(400).json({ success: false, message: 'Select an active faculty account' });

    // credit title lookup (optional)
    let creditTitle = null;
    if (creditTitleId) {
      creditTitle = await CreditTitle.findById(creditTitleId);
      if (!creditTitle) return res.status(404).json({ success: false, message: 'Credit title not found' });
      if (creditTitle.type !== 'positive' || creditTitle.isActive === false) return res.status(400).json({ success: false, message: 'Select an active positive credit title' });
    }
    const positivePoints = creditTitle ? Math.abs(Number(creditTitle.points)) : Number(points);
    const maxPoints = Math.max(1, Number(process.env.MAX_ISSUED_CREDIT_POINTS) || 10000);
    if (!Number.isFinite(positivePoints) || positivePoints <= 0 || positivePoints > maxPoints) return res.status(400).json({ success: false, message: 'Positive points must be greater than zero and within the configured limit' });
    if (!creditTitle && !String(title || '').trim()) return res.status(400).json({ success: false, message: 'A title is required for a manual positive award' });

    // File upload
    let proofUrl, proofMeta;
    if (req.file) {
      const uploadResult = await handleFileUpload(req.file, `credits/positive/${academicYear}`);
      proofUrl = uploadResult.proofUrl;
      proofMeta = uploadResult.proofMeta;
    }

    const actor = req.user;
    const creditItem = await Credit.create({
      faculty: String(faculty._id),
      facultySnapshot: {
        name: faculty.name,
        facultyID: faculty.facultyID,
        college: faculty.college,
        department: faculty.department,
      },
      type: 'positive',
      creditTitle: creditTitle ? String(creditTitle._id) : undefined,
      title: creditTitle ? creditTitle.title : String(title).trim(),
      points: positivePoints,
      notes: notes || 'Directly awarded by Admin/OA',
      academicYear,
      issuedBy: String(actor._id),
      proofUrl,
      proofMeta,
      status: 'approved', // Directly approved
      approvedBy: String(actor._id),
      approvedAt: new Date().toISOString(),
    });

    // Recalc
    try { await recalcFacultyCredits(faculty._id); } catch (e) { console.error('Recalc failed:', e); }

    // Socket emit
    const io = req.app?.locals?.io;
    if (io) io.emit(`faculty:${faculty._id}:creditUpdate`, creditItem);

    // 2. Send Push Notification
    sendPushToUser(String(faculty._id), {
      title: 'Success: Credits Awarded!',
      body: `You have been awarded ${creditItem.points} positive credits: ${creditItem.title}.`,
      url: '/u/credits',
      icon: '/icons/success.png'
    });

    return res.status(201).json({ success: true, message: 'Positive credit issued and approved', data: creditItem });
  } catch (err) {
    next(err);
  }
}

async function voidPositiveCredit(req, res, next) {
  try {
    await connectDB();
    const credit = await Credit.findById(req.params.id);
    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });
    if (credit.type !== 'positive') return res.status(400).json({ success: false, message: 'Only positive credits can be voided here' });
    if (credit.status === 'deleted') return res.status(409).json({ success: false, message: 'Credit is already voided' });
    const reason = String(req.body?.reason || 'Voided by an administrator').trim().slice(0, 1000);
    let updated;
    try {
      updated = await Credit.voidByActor(credit._id, req.user._id, credit.updatedAt,
        { reason, before: { status: credit.status, points: credit.points }, after: { status: 'deleted', points: 0 } });
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return res.status(409).json({ success: false, message: 'Credit changed; reload and try again' });
      throw error;
    }
    let balanceUpdated = true;
    try { await recalcFacultyCredits(String(credit.faculty)); }
    catch (error) { balanceUpdated = false; console.error('Positive credit voided but balance projection failed:', error); }
    return res.json({ success: true, balanceUpdated, message: 'Credit voided; record preserved', data: updated });
  } catch (error) { next(error); }
}

module.exports = { issueNegativeCredit, issuePositiveCredit, voidPositiveCredit };

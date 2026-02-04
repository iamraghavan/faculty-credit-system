const Credit = require('../../Models/Credit');
const CreditTitle = require('../../Models/CreditTitle');
const User = require('../../Models/User');
const { connectDB } = require('../../config/db');
const { recalcFacultyCredits } = require('../../utils/calculateCredits');
const { handleFileUpload } = require('../../utils/fileUpload');
const { schemas } = require('../../utils/validation');
const fs = require('fs');
const path = require('path');



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

    // credit title lookup
    let creditTitle = null;
    if (creditTitleId) {
      creditTitle = await CreditTitle.findById(creditTitleId);
      if (!creditTitle) return res.status(404).json({ success: false, message: 'Credit title not found' });
    }

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
      title: title || (creditTitle && creditTitle.title) || 'Negative Credit',
      points: points !== undefined ? Number(points) : (creditTitle ? -Math.abs(creditTitle.points) : 0),
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

    return res.status(201).json({ success: true, data: creditItem });
  } catch (err) {
    next(err);
  }
}

module.exports = { issueNegativeCredit };

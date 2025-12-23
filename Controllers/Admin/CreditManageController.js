const Credit = require('../../Models/Credit');
const CreditTitle = require('../../Models/CreditTitle');
const User = require('../../Models/User');
const { connectDB } = require('../../config/db');
const { recalcFacultyCredits } = require('../../utils/calculateCredits');
const { uploadFileToGitHub, uploadFileToGitHubBuffer } = require('../../utils/githubUpload');
const { schemas } = require('../../utils/validation');
const fs = require('fs');
const path = require('path');

// Reusing helper from original controller or shared util. 
// Ideally should be in utils/fileUpload.js, but keeping inline for now or duplicating logic safely.
async function handleFileUpload(file, folder) {
  if (!file) return {};
  const originalName = file.originalname || 'upload';
  const safeName = path.basename(originalName).replace(/[^\w.\-() ]+/g, '_').slice(0, 200);
  const destPath = `${folder}/${Date.now()}_${safeName}`;
  
  const isBuffer = Buffer.isBuffer(file.buffer);
  const tmpPath = file.path;

  if (!process.env.GITHUB_TOKEN) {
     if (tmpPath) try { fs.unlinkSync(tmpPath); } catch (e) {}
     throw new Error('GitHub upload not configured.');
  }

  try {
    let proofUrl;
    if (isBuffer) {
      proofUrl = await uploadFileToGitHubBuffer(file.buffer, destPath);
    } else if (tmpPath) {
      proofUrl = await uploadFileToGitHub(tmpPath, destPath);
      try { fs.unlinkSync(tmpPath); } catch (e) {}
    }
    return {
      proofUrl,
      proofMeta: {
        originalName,
        size: file.size,
        mimeType: file.mimetype
      }
    };
  } catch (err) {
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch (e) {}
    throw new Error('Upload failed: ' + err.message);
  }
}

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

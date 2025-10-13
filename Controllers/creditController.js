// Controllers/creditController.js
const Credit = require('../Models/Credit');
const User = require('../Models/User');
const CreditTitle = require('../Models/CreditTitle');
const { uploadFileToGitHub } = require('../utils/githubUpload'); // optional
const path = require('path');
const fs = require('fs');
const { sendEmail } = require('../utils/email');

/**
 * Admin creates a credit title (positive or negative)
 */
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

/**
 * List active credit titles (faculty/admin)
 */
async function listCreditTitles(req, res, next) {
  try {
    const items = await CreditTitle.find({ isActive: true });
    res.json({ success: true, total: items.length, items });
  } catch (err) {
    next(err);
  }
}

async function submitPositiveCredit(req, res, next) {
  try {
    const faculty = req.user;
    if (!faculty || faculty.role !== 'faculty') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    let { title, points, categories, academicYear, notes } = req.body;

    if (!title || !points || !academicYear) {
      return res.status(400).json({ success: false, message: 'Missing required fields: title, points, or academicYear' });
    }

    points = Number(points);
    if (Number.isNaN(points) || points <= 0) {
      return res.status(400).json({ success: false, message: 'Points must be a positive number' });
    }

    let creditTitleDoc = null;

    // Normalize categories: accept array or CSV string or CreditTitle IDs
    if (categories) {
      // convert CSV string to array if needed
      if (typeof categories === 'string') {
        categories = categories.includes(',') ? categories.split(',').map(s => s.trim()) : [categories];
      }

      const ids = categories.map(c => c.trim()).filter(Boolean);

      if (ids.length) {
        const creditTitles = await CreditTitle.find({ _id: { $in: ids } });
        if (!creditTitles.length) {
          return res.status(400).json({ success: false, message: 'Invalid CreditTitle ID(s) for categories' });
        }
        creditTitleDoc = creditTitles[0]; // pick first for reference (optional)
        // Merge all categories
        categories = [...new Set(creditTitles.reduce((acc, ct) => acc.concat(ct.categories || []), []))];
      } else {
        categories = [];
      }
    } else {
      categories = [];
    }

    // Handle proof file
    let proofUrl, proofMeta;
    if (req.file) {
      const tmpPath = req.file.path;
      const destPath = `assets/${academicYear}/${Date.now()}_${req.file.originalname}`;

      if (process.env.GITHUB_TOKEN && process.env.ASSET_GH_REPO && process.env.ASSET_GH_OWNER) {
        try {
          proofUrl = await uploadFileToGitHub(tmpPath, destPath);
        } catch (err) {
          console.warn('GitHub upload failed, fallback to local:', err.message);
          proofUrl = `/uploads/${path.basename(tmpPath)}`;
        }
      } else {
        proofUrl = `/uploads/${path.basename(tmpPath)}`;
      }

      proofMeta = {
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
      };

      try { fs.unlinkSync(tmpPath); } catch (e) { }
    }

    // Create the Credit
    const creditDoc = await Credit.create({
      faculty: faculty._id,
      facultySnapshot: {
        facultyID: faculty.facultyID,
        name: faculty.name,
        college: faculty.college,
        department: faculty.department,
      },
      type: 'positive',
      creditTitle: creditTitleDoc ? creditTitleDoc._id : undefined,
      title,
      points,
      categories,
      proofUrl,
      proofMeta,
      academicYear,
      issuedBy: faculty._id,
      status: 'approved',
      notes: notes || undefined,
    });

    // Update faculty credits
    faculty.currentCredit = (Number(faculty.currentCredit) || 0) + points;
    if (faculty.creditsByYear && typeof faculty.creditsByYear.set === 'function') {
      const prev = Number(faculty.creditsByYear.get(academicYear) || 0);
      faculty.creditsByYear.set(academicYear, prev + points);
    } else {
      faculty.creditsByYear = faculty.creditsByYear || {};
      const prev = Number(faculty.creditsByYear[academicYear] || 0);
      faculty.creditsByYear[academicYear] = prev + points;
    }

    await faculty.save();

    res.status(201).json({ success: true, data: creditDoc });
  } catch (err) {
    if (err.message && err.message.includes('File type not allowed')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
}


/**
 * Admin issues negative credit to a faculty (with email notification)
 */
async function adminIssueNegativeCredit(req, res, next) {
  try {
    const actor = req.user;
    if (!actor || actor.role !== 'admin') 
      return res.status(403).json({ success: false, message: 'Forbidden' });

    const { facultyId, creditTitleId, academicYear, notes } = req.body;
    if (!facultyId || !creditTitleId || !academicYear) 
      return res.status(400).json({ success: false, message: 'Missing fields' });

    const faculty = await User.findById(facultyId);
    if (!faculty) return res.status(404).json({ success: false, message: 'Faculty not found' });

    const ct = await CreditTitle.findById(creditTitleId);
    if (!ct || ct.type !== 'negative')
      return res.status(400).json({ success: false, message: 'Invalid negative credit title' });

    // Handle proof file
    let proofUrl;
    let proofMeta;
    if (req.file) {
      const tmpPath = req.file.path;
      const destPath = `assets/${academicYear}/${Date.now()}_${req.file.originalname}`;

      if (process.env.GITHUB_TOKEN && process.env.ASSET_GH_REPO && process.env.ASSET_GH_OWNER) {
        try {
          proofUrl = await uploadFileToGitHub(tmpPath, destPath);
        } catch (err) {
          proofUrl = `/uploads/${path.basename(tmpPath)}`;
        }
      } else {
        proofUrl = `/uploads/${path.basename(tmpPath)}`;
      }

      proofMeta = { originalName: req.file.originalname, size: req.file.size, mimeType: req.file.mimetype };
      try { fs.unlinkSync(tmpPath); } catch (e) {}
    }

    const c = await Credit.create({
      faculty: faculty._id,
      facultySnapshot: { facultyID: faculty.facultyID, name: faculty.name, college: faculty.college },
      type: 'negative',
      title: ct.title,
      points: -Math.abs(ct.points),
      proofUrl,
      proofMeta,
      academicYear,
      issuedBy: actor._id,
      status: 'approved'
    });

    // Update faculty credits
    faculty.currentCredit = (faculty.currentCredit || 0) - Math.abs(ct.points);
    const prevYearPoints = Number(faculty.creditsByYear?.get(academicYear) || 0);
    faculty.creditsByYear.set(academicYear, prevYearPoints - Math.abs(ct.points));
    await faculty.save();

    // Send email notification
    try {
      await sendEmail({
        to: faculty.email,
        subject: `Negative Credit Issued: ${ct.title}`,
        text: `Dear ${faculty.name},\n\nA negative credit (${ct.points}) has been issued against you for ${academicYear}.\nReason: ${notes || 'Not provided'}\n\nRegards,\nAdmin`
      });
    } catch (err) {
      console.warn('Failed to send email:', err.message);
    }

    res.status(201).json({ success: true, data: c });
  } catch (err) {
    next(err);
  }
}

/**
 * Faculty appeals negative credit
 */
async function appealNegativeCredit(req, res, next) {
  try {
    const actor = req.user;
    if (!actor) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { creditId, reason } = req.body;
    if (!creditId || !reason) return res.status(400).json({ success: false, message: 'Missing fields' });

    const credit = await Credit.findById(creditId);
    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });
    if (credit.type !== 'negative') return res.status(400).json({ success: false, message: 'Only negative credits can be appealed' });
    if (String(credit.faculty) !== String(actor._id) && actor.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only affected faculty or admin can appeal' });
    }

    credit.appeal = { by: actor._id, reason, createdAt: new Date(), status: 'pending' };
    credit.status = 'appealed';
    await credit.save();

    // Email admins
    const admins = await User.find({ role: 'admin' });
    const adminEmails = admins.map(a => a.email).filter(Boolean);
    if (adminEmails.length) {
      try {
        await sendEmail({
          to: adminEmails.join(','),
          subject: `Appeal for Negative Credit: ${credit.title}`,
          text: `Faculty ${actor.name} has appealed credit ${credit._id}.\nReason:\n${reason}`
        });
      } catch (err) {
        console.warn('Failed to send appeal email:', err.message);
      }
    }

    res.json({ success: true, data: credit });
  } catch (err) {
    next(err);
  }
}

/**
 * List credits for a faculty (with pagination)
 */
async function listCreditsForFaculty(req, res, next) {
  try {
    const { facultyId } = req.params;
    const { page = 1, limit = 20, academicYear } = req.query;

    const filter = { faculty: facultyId };
    if (academicYear) filter.academicYear = academicYear;

    const skip = (Number(page) - 1) * Number(limit);
    const total = await Credit.countDocuments(filter);
    const items = await Credit.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit));

    res.json({ success: true, total, page: Number(page), limit: Number(limit), items });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createCreditTitle,
  listCreditTitles,
  submitPositiveCredit,
  adminIssueNegativeCredit,
  appealNegativeCredit,
  listCreditsForFaculty
};

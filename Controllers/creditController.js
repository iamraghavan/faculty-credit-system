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
     * List credits for faculty (frontend-friendly)
     * GET /api/v1/credits/faculty/:facultyId?academicYear=2024-2025&status=Approved&page=1&limit=20
     */
    async function listCreditsForFaculty(req, res, next) {
    try {
        const { facultyId } = req.params;
        const { page = 1, limit = 20, academicYear, status } = req.query;

        // Validate facultyId
        if (!facultyId) return res.status(400).json({ success: false, message: 'Missing facultyId' });

        // Base filter
        const filter = { faculty: facultyId };

        // Filter by academic year (if provided and not "All")
        if (academicYear && String(academicYear).trim().toLowerCase() !== 'all') {
          filter.academicYear = String(academicYear).trim();
        }

        // Filter by status (if provided and not "All")
        if (status && String(status).trim().toLowerCase() !== 'all') {
          // Accept common user-friendly values (case-insensitive)
          const allowed = ['pending', 'approved', 'rejected', 'appealed']; // expand if needed
          const statusNorm = String(status).trim().toLowerCase();

          if (!allowed.includes(statusNorm)) {
            return res.status(400).json({
              success: false,
              message: `Invalid status filter. Allowed values: ${['All', ...allowed.map(s => s.charAt(0).toUpperCase() + s.slice(1))].join(', ')}`
            });
          }

          // Store lowercase status (matches DB stored values like "approved")
          filter.status = statusNorm;
        }

        const skip = (Math.max(Number(page), 1) - 1) * Math.max(Number(limit), 1);

        const [total, items] = await Promise.all([
          Credit.countDocuments(filter),
          Credit.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Math.max(Number(limit), 1))
            .populate('faculty', 'name facultyID department') // optional populate
            .lean(),
        ]);

        res.json({
          success: true,
          total,
          page: Number(page),
          limit: Number(limit),
          filters: {
            academicYear: academicYear || 'All',
            status: status || 'All',
          },
          items,
        });
      } catch (err) {
        console.error('listCreditsForFaculty error:', err);
        next(err);
      }
    };


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


  /**
   * Get all negative credits for a faculty with filters
   */
  async function getNegativeCredits(req, res, next) {
    try {
      const faculty = req.user;
      if (!faculty || faculty.role !== 'faculty')
        return res.status(403).json({ success: false, message: 'Forbidden' });

      const { page = 1, limit = 20, status, academicYear, sort = '-createdAt' } = req.query;

      const filter = { faculty: faculty._id, type: 'negative' };

      if (status && status.toLowerCase() !== 'all')
        filter.status = status.toLowerCase();

      if (academicYear && academicYear.toLowerCase() !== 'all')
        filter.academicYear = academicYear;

      const skip = (Math.max(Number(page), 1) - 1) * Math.max(Number(limit), 1);

      const [total, items] = await Promise.all([
        Credit.countDocuments(filter),
        Credit.find(filter)
          .sort(sort)
          .skip(skip)
          .limit(Number(limit))
          .populate('issuedBy', 'name email role')
          .populate('appeal.by', 'name email facultyID')
          .lean(),
      ]);

      res.json({
        success: true,
        total,
        page: Number(page),
        limit: Number(limit),
        filters: { academicYear: academicYear || 'All', status: status || 'All' },
        items,
      });
    } catch (err) {
      console.error('getNegativeCredits error:', err);
      next(err);
    }
  }

async function appealNegativeCredit(req, res, next) {
  try {
    const faculty = req.user;
    const creditId = req.params.creditId; // from route /credits/:creditId/appeal
    const reason = (req.body.reason || '').trim();

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Appeal reason required' });
    }

    const credit = await Credit.findById(creditId);
    if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });

    if (credit.type !== 'negative') {
      return res.status(400).json({ success: false, message: 'Only negative credits can be appealed' });
    }

    if (String(credit.faculty) !== String(faculty._id)) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Prevent submitting if there is already a pending appeal
    if (credit.appeal && credit.appeal.status === 'pending') {
      return res.status(400).json({ success: false, message: 'An appeal is already pending for this credit' });
    }

    // Track total number of appeals allowed per faculty for this credit (max 2)
    const currentAttempts = credit.appealCount || 0;
    if (currentAttempts >= 2) {
      return res.status(400).json({ success: false, message: 'Maximum number of appeals (2) has been reached' });
    }

    let proofUrl = undefined;
    let proofMeta = undefined;

    if (req.file) {
      const tmpPath = req.file.path;
      const originalName = req.file.originalname || 'upload';
      // sanitize and reduce filename length to avoid path issues
      const safeOriginal = path.basename(originalName).replace(/[^\w.\-() ]+/g, '_').slice(0, 200);
      const destPath = `appeals/${creditId}/${Date.now()}_${safeOriginal}`;

      try {
        // MUST upload to GitHub; do not fallback to local
        proofUrl = await uploadFileToGitHub(tmpPath, destPath);
      } catch (uploadErr) {
        console.error('GitHub upload failed:', uploadErr);
        // try to clean temp file, then return error to client
        try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
        return res.status(500).json({ success: false, message: 'Failed to upload proof file. Please try again later.' });
      }

      // cleanup temp file after successful upload
      try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }

      proofMeta = {
        originalName: originalName,
        size: req.file.size,
        mimeType: req.file.mimetype,
      };
    }

    // Create new appeal object and increment attempt count
    credit.appeal = {
      by: faculty._id,
      reason,
      proofUrl,
      proofMeta,
      createdAt: new Date(),
      status: 'pending',
    };
    credit.status = 'appealed';
    credit.appealCount = currentAttempts + 1;

    await credit.save();

    return res.json({ success: true, message: 'Appeal submitted successfully', data: credit });
  } catch (err) {
    console.error('appealNegativeCredit error:', err);
    next(err);
  }
}


  async function getNegativeCreditsByFacultyId(req, res, next) {
  try {
    const { facultyId } = req.params;
    const { page = 1, limit = 20, status, academicYear, sort = '-createdAt' } = req.query;

    if (!facultyId || !mongoose.Types.ObjectId.isValid(facultyId)) {
      return res.status(400).json({ success: false, message: 'Invalid or missing facultyId' });
    }

    const filter = { faculty: facultyId, type: 'negative' };

    if (status && status.toLowerCase() !== 'all') {
      filter.status = status.toLowerCase();
    }

    if (academicYear && academicYear.toLowerCase() !== 'all') {
      filter.academicYear = academicYear;
    }

    const skip = (Math.max(Number(page), 1) - 1) * Math.max(Number(limit), 1);

    const [total, items] = await Promise.all([
      Credit.countDocuments(filter),
      Credit.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
        .populate('faculty', 'name email facultyID college department')
        .populate('issuedBy', 'name email role')
        .populate('appeal.by', 'name email facultyID')
        .lean(),
    ]);

    res.json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      filters: {
        academicYear: academicYear || 'All',
        status: status || 'All',
      },
      items,
    });
  } catch (err) {
    console.error('getNegativeCreditsByFacultyId error:', err);
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
  };


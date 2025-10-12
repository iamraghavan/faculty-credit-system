// Controllers/userController.js
const bcrypt = require('bcryptjs');
const User = require('../Models/User');

/**
 * Get current user profile (token-based auth)
 */
async function getProfile(req, res, next) {
  try {
    // req.user set by authMiddleware
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    res.json({ success: true, data: req.user });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin-only: create a faculty (alternative registration route for admins)
 */
async function adminCreateUser(req, res, next) {
  try {
    const { name, email, password, college, role } = req.body;
    if (!name || !email || !college || !password) return res.status(400).json({ success: false, message: 'Missing fields' });

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ success: false, message: 'User exists' });

    const hashed = await bcrypt.hash(password, 10);
    const { generateFacultyID, generateApiKey } = require('../utils/generateID');
    const facultyID = generateFacultyID(college);
    const apiKey = generateApiKey();

    const user = await User.create({
      name,
      email,
      password: hashed,
      college,
      department,
      facultyID,
      apiKey,
      role: role === 'admin' ? 'admin' : 'faculty',
    });

    res.status(201).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

/**
 * Search / paginate users (admin)
 */
const escapeRegExp = (str = '') =>
  str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function listUsers(req, res, next) {
  try {
    const {
      page = 1,
      limit = 20,
      q,
      department,   // comma-separated or single
      college,      // comma-separated or single
      role,         // single or comma-separated (faculty,admin)
      isActive,     // 'true'|'false'|'1'|'0'
      minCredit,    // number for currentCredit
      maxCredit,    // number for currentCredit
      year,         // academic year key for creditsByYear, e.g. "2024-2025"
      minCreditYear, // numeric minimum for creditsByYear.{year}
      maxCreditYear, // numeric maximum for creditsByYear.{year}
      sortBy = 'createdAt', // field to sort by
      sortOrder = 'desc',   // 'asc'|'desc'
    } = req.query;

    const filter = {};

    // Full-text-ish q search (name, facultyID, email)
    if (q) {
      const qRegex = new RegExp(escapeRegExp(q), 'i');
      filter.$or = [
        { name: qRegex },
        { facultyID: qRegex },
        { email: qRegex },
      ];
    }

    // Helper to parse comma separated values into regex array
    const parseListToRegexArray = (val) => {
      if (!val) return null;
      return val
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(v => new RegExp(`^${escapeRegExp(v)}$`, 'i'));
    };

    // Department filter (supports comma-separated, case-insensitive exact matches)
    const deptArr = parseListToRegexArray(department);
    if (deptArr && deptArr.length) {
      filter.department = { $in: deptArr };
    }

    // College filter (comma-separated)
    const collegeArr = parseListToRegexArray(college);
    if (collegeArr && collegeArr.length) {
      filter.college = { $in: collegeArr };
    }

    // Role filter (faculty/admin) - exact match, support comma-separated
    const roleArr = parseListToRegexArray(role);
    if (roleArr && roleArr.length) {
      filter.role = { $in: roleArr };
    }

    // isActive filter
    if (typeof isActive !== 'undefined') {
      const val = String(isActive).toLowerCase();
      if (val === 'true' || val === '1') filter.isActive = true;
      else if (val === 'false' || val === '0') filter.isActive = false;
      // otherwise ignore invalid values
    }

    // currentCredit numeric range
    if (typeof minCredit !== 'undefined' || typeof maxCredit !== 'undefined') {
      filter.currentCredit = {};
      if (typeof minCredit !== 'undefined' && !Number.isNaN(Number(minCredit))) {
        filter.currentCredit.$gte = Number(minCredit);
      }
      if (typeof maxCredit !== 'undefined' && !Number.isNaN(Number(maxCredit))) {
        filter.currentCredit.$lte = Number(maxCredit);
      }
      // remove empty object if no valid numeric filters
      if (Object.keys(filter.currentCredit).length === 0) delete filter.currentCredit;
    }

    // creditsByYear.{year} filters
    if (year) {
      const field = `creditsByYear.${year}`;
      // existence check (if no min/max provided)
      const minY = Number(minCreditYear);
      const maxY = Number(maxCreditYear);
      if (!Number.isNaN(minY) || !Number.isNaN(maxY)) {
        filter[field] = {};
        if (!Number.isNaN(minY)) filter[field].$gte = minY;
        if (!Number.isNaN(maxY)) filter[field].$lte = maxY;
      } else {
        // just require that the map has that year key
        filter[field] = { $exists: true };
      }
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const perPage = Math.max(1, Math.min(100, Number(limit) || 20)); // cap limit to 100
    const skip = (pageNum - 1) * perPage;

    // build sort
    const sort = {};
    const allowedSortOrder = String(sortOrder).toLowerCase() === 'asc' ? 1 : -1;
    // basic safety: allow sortBy only on some fields or fallback to createdAt
    const safeSortFields = new Set(['createdAt', 'name', 'facultyID', 'email', 'currentCredit', 'college', 'department', 'role', 'isActive']);
    const sortField = safeSortFields.has(sortBy) ? sortBy : 'createdAt';
    sort[sortField] = allowedSortOrder;

    // Parallel count + query
    const [total, items] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .skip(skip)
        .limit(perPage)
        .sort(sort)
        .select('-password')
    ]);

    const totalPages = Math.ceil(total / perPage);

    res.json({
      success: true,
      total,
      page: pageNum,
      pages: totalPages,
      limit: perPage,
      itemsCount: items.length,
      items,
    });
  } catch (err) {
    next(err);
  }
}


module.exports = { getProfile, adminCreateUser, listUsers };

// Controllers/userController.js
const bcrypt = require('bcryptjs');
const User = require('../Models/User');
const { handleProfileImageUpload } = require('../utils/uploadProfileImage');

/**
 * Get current user profile
 */
async function getProfile(req, res, next) {
  try {
    if (!req.user)
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    res.json({ success: true, data: req.user });
  } catch (err) {
    next(err);
  }
}

/**
 * Update current user profile (with GitHub image upload)
 */
async function updateProfile(req, res, next) {
  try {
    if (!req.user)
      return res.status(401).json({ success: false, message: 'Unauthorized' });

    const allowedFields = ['name', 'email', 'phone', 'department'];
    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    // Handle profile image upload via GitHub
    if (req.file) {
      updates.profileImage = await handleProfileImageUpload(req.file);
    }

    // Prevent duplicate email
    if (updates.email && updates.email !== req.user.email) {
      const exists = await User.findOne({ email: updates.email });
      if (exists) {
        return res
          .status(400)
          .json({ success: false, message: 'Email already in use' });
      }
    }

    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true, select: '-password' }
    );

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin-only: create user (with optional GitHub image upload)
 */
async function adminCreateUser(req, res, next) {
  try {
    const { name, email, password, college, department, role } = req.body;
    if (!name || !email || !college || !password)
      return res
        .status(400)
        .json({ success: false, message: 'Missing required fields' });

    const exists = await User.findOne({ email });
    if (exists)
      return res
        .status(400)
        .json({ success: false, message: 'User already exists' });

    const hashed = await bcrypt.hash(password, 10);
    const { generateFacultyID, generateApiKey } = require('../utils/generateID');
    const facultyID = generateFacultyID(college);
    const apiKey = generateApiKey();

    const userData = {
      name,
      email,
      password: hashed,
      college,
      department,
      facultyID,
      apiKey,
      role: role === 'admin' ? 'admin' : 'faculty',
    };

    // Upload profile image if provided
    if (req.file) {
      userData.profileImage = await handleProfileImageUpload(req.file);
    }

    const user = await User.create(userData);
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: get all users with filters and pagination
 */
const escapeRegExp = (str = '') =>
  str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function listUsers(req, res, next) {
  try {
    const {
      page = 1,
      limit = 20,
      q,
      department,
      college,
      role,
      isActive,
      minCredit,
      maxCredit,
      year,
      minCreditYear,
      maxCreditYear,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const filter = {};

    if (q) {
      const qRegex = new RegExp(escapeRegExp(q), 'i');
      filter.$or = [{ name: qRegex }, { facultyID: qRegex }, { email: qRegex }];
    }

    const parseListToRegexArray = (val) =>
      val
        ?.split(',')
        .map((s) => new RegExp(`^${escapeRegExp(s.trim())}$`, 'i'))
        .filter(Boolean);

    const deptArr = parseListToRegexArray(department);
    if (deptArr?.length) filter.department = { $in: deptArr };

    const collegeArr = parseListToRegexArray(college);
    if (collegeArr?.length) filter.college = { $in: collegeArr };

    const roleArr = parseListToRegexArray(role);
    if (roleArr?.length) filter.role = { $in: roleArr };

    if (typeof isActive !== 'undefined') {
      const val = String(isActive).toLowerCase();
      if (val === 'true' || val === '1') filter.isActive = true;
      else if (val === 'false' || val === '0') filter.isActive = false;
    }

    if (minCredit || maxCredit) {
      filter.currentCredit = {};
      if (minCredit) filter.currentCredit.$gte = Number(minCredit);
      if (maxCredit) filter.currentCredit.$lte = Number(maxCredit);
    }

    if (year) {
      const field = `creditsByYear.${year}`;
      const minY = Number(minCreditYear);
      const maxY = Number(maxCreditYear);
      if (!Number.isNaN(minY) || !Number.isNaN(maxY)) {
        filter[field] = {};
        if (!Number.isNaN(minY)) filter[field].$gte = minY;
        if (!Number.isNaN(maxY)) filter[field].$lte = maxY;
      } else {
        filter[field] = { $exists: true };
      }
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const perPage = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (pageNum - 1) * perPage;

    const allowedSortOrder = sortOrder.toLowerCase() === 'asc' ? 1 : -1;
    const safeSortFields = new Set([
      'createdAt',
      'name',
      'facultyID',
      'email',
      'currentCredit',
      'college',
      'department',
      'role',
      'isActive',
    ]);
    const sortField = safeSortFields.has(sortBy) ? sortBy : 'createdAt';
    const sort = { [sortField]: allowedSortOrder };

    const [total, items] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .skip(skip)
        .limit(perPage)
        .sort(sort)
        .select('-password'),
    ]);

    res.json({
      success: true,
      total,
      page: pageNum,
      pages: Math.ceil(total / perPage),
      limit: perPage,
      itemsCount: items.length,
      items,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: get a single user
 */
async function getUserById(req, res, next) {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user)
      return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: update user (with GitHub image upload)
 */
async function adminUpdateUser(req, res, next) {
  try {
    const allowedFields = [
      'name',
      'email',
      'phone',
      'department',
      'college',
      'role',
      'isActive',
      'profileImage',
    ];
    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    // Handle profile image upload
    if (req.file) {
      updates.profileImage = await handleProfileImageUpload(req.file);
    }

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true, select: '-password' }
    );

    if (!updated)
      return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: delete a user
 */
async function deleteUser(req, res, next) {
  try {
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted)
      return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProfile,
  updateProfile,
  adminCreateUser,
  listUsers,
  getUserById,
  adminUpdateUser,
  deleteUser,
};

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
async function listUsers(req, res, next) {
  try {
    const { page = 1, limit = 20, q } = req.query;
    const filter = {};
    if (q) {
      filter.$or = [
        { name: new RegExp(q, 'i') },
        { facultyID: new RegExp(q, 'i') },
        { email: new RegExp(q, 'i') },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const total = await User.countDocuments(filter);
    const items = await User.find(filter).skip(skip).limit(Number(limit)).select('-password');
    res.json({ success: true, total, page: Number(page), limit: Number(limit), items });
  } catch (err) {
    next(err);
  }
}

module.exports = { getProfile, adminCreateUser, listUsers };

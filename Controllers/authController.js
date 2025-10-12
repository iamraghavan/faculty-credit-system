// Controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../Models/User');
const { generateFacultyID, generateApiKey } = require('../utils/generateID');

/**
 * Register a new user (first user or subsequent users)
 * First user can be admin or faculty (role sent in body)
 * After first user, only logged-in admin can create new users
 */
async function register(req, res, next) {
  try {
    const { name, email, password, college, department, role } = req.body;
    if (!name || !email || !password || !college) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'Email already exists' });

    let assignedRole = 'faculty'; // default role

    const userCount = await User.countDocuments();

    if (userCount === 0) {
      // First user can be any role sent in body (admin or faculty)
      if (role === 'admin') assignedRole = 'admin';
      else assignedRole = 'faculty';
    } else {
      // Only logged-in admin can create new users
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Only admin can create users' });
      }
      // Role can only be 'faculty' or 'admin'
      if (role === 'admin' || role === 'faculty') assignedRole = role;
    }

    const facultyID = generateFacultyID(college);
    const apiKey = generateApiKey();
    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashed,
      college,
      facultyID,
      apiKey,
      department,
      role: assignedRole,
    });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });

    res.status(201).json({
      success: true,
      data: {
        id: user._id,
        name: user.name,
        facultyID: user.facultyID,
        apiKey: user.apiKey,
        role: user.role,
        department: user.department,
        token,
      },
    });

  } catch (err) {
    next(err);
  }
}


/**
 * Login with email & password
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Missing credentials' });

    const user = await User.findOne({ email }).select('+password');
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });

    res.json({
      success: true,
      data: {
        id: user._id,
        name: user.name,
        facultyID: user.facultyID,
        apiKey: user.apiKey,
        role: user.role,
        department: user.department,
        token,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Simple endpoint to refresh token (re-issue)
 */
async function refreshToken(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const token = jwt.sign({ id: req.user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });
    res.json({ success: true, token });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, refreshToken };

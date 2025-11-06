// Controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../Models/User');
const { generateFacultyID, generateApiKey } = require('../utils/generateID');
const { recalcFacultyCredits } = require('../utils/calculateCredits');

/**
 * Register a new user (DynamoDB version)
 */
async function register(req, res, next) {
  try {
    const { name, email, password, college, department, role } = req.body;
    if (!name || !email || !password || !college) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // Duplicate email check
    const existingUsers = await User.find({ email: normalizedEmail });
    if (existingUsers && existingUsers.length > 0) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    // Role assignment logic
    let assignedRole = 'faculty'; // default for self-registration

    const allUsers = await User.find();
    if (!allUsers || allUsers.length === 0) {
      // First user: allow admin, oa, or faculty
      if (['admin', 'oa'].includes(role)) assignedRole = role;
      else assignedRole = 'faculty';
    } else {
      // There are existing users
      if (req.user && req.user.role === 'admin') {
        // Admin can create any role
        if (['admin', 'oa', 'faculty'].includes(role)) assignedRole = role;
        else assignedRole = 'faculty';
      } else {
        // Non-admins (self-registration)
        assignedRole = 'faculty';
      }
    }

    // Hash password
    const hashed = await bcrypt.hash(password, 10);

    // Generate IDs and keys
    const facultyID = generateFacultyID(college);
    const apiKey = generateApiKey();

    const newUserPayload = {
      name,
      email: normalizedEmail,
      password: hashed,
      college,
      department,
      facultyID,
      apiKey,
      role: assignedRole,
      currentCredit: 0,
      creditsByYear: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const newUser = await User.create(newUserPayload);

    const userIdForToken = newUser._id || newUser.id || newUser.pk || newUser.userId;
    const token = jwt.sign(
      { id: userIdForToken, role: assignedRole },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );

    return res.status(201).json({
      success: true,
      data: {
        id: userIdForToken,
        name: newUser.name,
        facultyID: newUser.facultyID,
        apiKey: newUser.apiKey,
        role: newUser.role,
        department: newUser.department,
        token,
      },
    });
  } catch (err) {
    next(err);
  }
}


/**
 * Login with email & password (DynamoDB version)
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Missing credentials' });

    const users = await User.find({ email });
    if (users.length === 0)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const user = users[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    // Recalculate credits only for faculty
    if (user.role === 'faculty') {
      try {
        await recalcFacultyCredits(user._id);
      } catch (err) {
        console.error('Credit recalculation failed', err);
      }
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );

    const freshUser = await User.findById(user._id);

    res.json({
      success: true,
      data: {
        id: freshUser._id,
        name: freshUser.name,
        facultyID: freshUser.facultyID,
        apiKey: freshUser.apiKey,
        role: freshUser.role,
        department: freshUser.department,
        currentCredit: freshUser.currentCredit,
        creditsByYear: freshUser.creditsByYear,
        token,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Refresh token
 */
async function refreshToken(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const token = jwt.sign(
      { id: req.user._id, role: req.user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );
    res.json({ success: true, token });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, refreshToken };

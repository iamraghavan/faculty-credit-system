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

    // normalize email
    const normalizedEmail = String(email).trim().toLowerCase();

    // duplicate email check
    const existingUsers = await User.find({ email: normalizedEmail });
    if (existingUsers && existingUsers.length > 0) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    // Decide assigned role:
    // - If no users exist: allow role param to create first admin (or faculty)
    // - Else if an admin (req.user.role === 'admin') is creating: allow requested role
    // - Else: allow unauthenticated/self-registration only to 'faculty' role (ignore role param)
    let assignedRole = 'faculty';

    const allUsers = await User.find();
    if (!allUsers || allUsers.length === 0) {
      // first user: honor the role param if 'admin' requested, otherwise default to faculty
      if (role === 'admin') assignedRole = 'admin';
      else assignedRole = 'faculty';
    } else {
      // there are existing users
      if (req.user && req.user.role === 'admin') {
        // logged-in admin can create any role (admin or faculty)
        if (role === 'admin' || role === 'faculty') assignedRole = role;
        else assignedRole = 'faculty';
      } else {
        // not admin (or no token): allow self-registration but force role=faculty
        assignedRole = 'faculty';
      }
    }

    // Hash password
    const hashed = await bcrypt.hash(password, 10);

    // generate IDs and keys
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

    // sign JWT containing the Dynamo/Mongo id shape your auth expects
    // If your User model uses _id for Dynamo, use newUser._id; otherwise use newUser.id
    const userIdForToken = newUser._id || newUser.id || newUser.pk || newUser.userId;
    const token = jwt.sign({ id: userIdForToken, role: assignedRole }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });

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
    if (!email || !password) return res.status(400).json({ success: false, message: 'Missing credentials' });

    const users = await User.find({ email });
    if (users.length === 0) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const user = users[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    // Recalculate credits before issuing token
    if (user.role === 'faculty') {
      try {
        await recalcFacultyCredits(user._id);
      } catch (err) {
        console.error('Credit recalculation failed', err);
      }
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });

    // Fetch updated user
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
    const token = jwt.sign({ id: req.user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });
    res.json({ success: true, token });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, refreshToken };

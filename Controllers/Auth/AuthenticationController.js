const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../../Models/User');
const { generateFacultyID, generateApiKey } = require('../../utils/generateID');
const { verifyTotpToken, generateMfaCode, sendMfaEmail } = require('../../utils/mfa');
const { schemas } = require('../../utils/validation');

/**
 * Register a new user
 */
async function register(req, res, next) {
  try {
    const { error, value } = schemas.auth.register.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { name, email, password, college, department, role } = value;
    const normalizedEmail = email.trim().toLowerCase();

    // Check Duplicate
    const existingUsers = await User.find({ email: normalizedEmail });
    if (existingUsers.length > 0) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    // Role Logic
    let assignedRole = 'faculty';
    const allUsers = await User.find(); // Expensive check for "first user", ideally use a count or config
    if (allUsers.length === 0) {
      if (['admin', 'oa'].includes(role)) assignedRole = role;
    } else if (req.user?.role === 'admin') {
      assignedRole = role || 'faculty';
    }

    // Hash Password
    const hashed = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      name,
      email: normalizedEmail,
      password: hashed,
      college,
      department,
      facultyID: generateFacultyID(college),
      apiKey: generateApiKey(),
      role: assignedRole,
      currentCredit: 0,
      creditsByYear: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const token = jwt.sign(
      { id: newUser._id, role: assignedRole },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );

    return res.status(201).json({
      success: true,
      data: {
        id: newUser._id,
        name: newUser.name,
        role: newUser.role,
        whatsappNumber: newUser.whatsappNumber,
        whatsappVerified: newUser.whatsappVerified,
        token
      }
    });

  } catch (err) {
    next(err);
  }
}

/**
 * Login
 */
async function login(req, res, next) {
  try {
    const { error, value } = schemas.auth.login.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { email, password, token: mfaToken } = value;

    const users = await User.find({ email: email.toLowerCase() });
    if (users.length === 0) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const user = users[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    // MFA Logic
    if (user.mfaEnabled) {
      // App MFA
      if (user.mfaAppEnabled) {
        if (!mfaToken) {
          return res.json({ success: true, mfaRequired: true, mfaType: 'app', userId: user._id });
        }
        const valid = verifyTotpToken(user.mfaSecret, mfaToken);
        if (!valid) return res.status(400).json({ success: false, message: 'Invalid MFA code' });
      }
      // Email MFA
      else if (user.mfaEmailEnabled) {
        // Send code logic...
        const code = generateMfaCode();
        await User.update(user._id, { mfaCode: code, mfaCodeExpires: Date.now() + 300000 });
        await sendMfaEmail(user, code);
        return res.json({ success: true, mfaRequired: true, mfaType: 'email', userId: user._id });
      }
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );

    res.json({
      success: true,
      mfaRequired: false,
      data: {
        id: user._id,
        name: user.name,
        role: user.role,
        whatsappNumber: user.whatsappNumber || null,
        whatsappVerified: user.whatsappVerified ?? false,
        token
      }
    });

  } catch (err) {
    next(err);
  }
}

module.exports = { register, login };

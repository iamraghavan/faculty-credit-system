const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../../Models/User');
const { generateFacultyID, generateApiKey } = require('../../utils/generateID');
const { verifyTotpToken, generateMfaCode, sendMfaEmail } = require('../../utils/mfa');
const { schemas } = require('../../utils/validation');
const Session = require('../../Models/Session');
const { permissionsFor } = require('../../config/permissions');

async function createLoginSession(user, req) {
  const timeout = Math.max(300000, Number(process.env.SESSION_TIMEOUT) || 3600000);
  const session = await Session.create({
    userId: String(user._id || user.id),
    device: req.headers['user-agent'] || 'Unknown device',
    lastIp: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || '',
    expiresAt: new Date(Date.now() + timeout).toISOString(),
    mfaVerifiedAt: user.mfaEnabled ? new Date().toISOString() : null,
  });

  const sessions = await Session.findByUserId(String(user._id || user.id));
  const maximum = Math.max(1, Number(process.env.MAX_ACTIVE_SESSIONS) || 5);
  for (const oldSession of sessions.slice(maximum)) await Session.revoke(oldSession._id);
  return session;
}

/**
 * Register a new user
 */
async function register(req, res, next) {
  try {
    const { error, value } = schemas.auth.register.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { name, email, password, college, department, role, fcmToken } = value;
    const normalizedEmail = email.trim().toLowerCase();

    // Check Duplicate
    const existingUsers = await User.find({ email: normalizedEmail });
    if (existingUsers.length > 0) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    // Role Logic
    let assignedRole = 'faculty';
    if (['admin', 'superadmin'].includes(req.user?.role)) assignedRole = role || 'faculty';
    if (assignedRole === 'faculty' && !String(department || '').trim()) {
      return res.status(400).json({ success: false, message: 'Faculty department is required' });
    }

    // Hash Password
    const hashed = await bcrypt.hash(password, 12);

    const newUser = await User.create({
      name,
      email: normalizedEmail,
      password: hashed,
      college,
      department,
      facultyID: generateFacultyID(college),
      apiKey: generateApiKey(),
      role: assignedRole,
      isActive: true,
      createdBy: String(req.user._id),
      fcmToken: fcmToken || null,
      currentCredit: 0,
      creditsByYear: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return res.status(201).json({
      success: true,
      data: {
        id: newUser._id,
        name: newUser.name,
        role: newUser.role,
        fcmToken: newUser.fcmToken || null,
        whatsappNumber: newUser.whatsappNumber || null,
        whatsappVerified: newUser.whatsappVerified || false,
        permissions: permissionsFor(newUser),
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

    const { email, password, token: mfaToken, fcmToken } = value;

    const users = await User.find({ email: email.toLowerCase() });
    if (users.length === 0) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const user = users[0];
    if (user.isActive === false) return res.status(403).json({ success: false, message: 'Account is inactive' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    // MFA Logic
    const targetUserId = user._id || user.id;

    if (user.mfaEnabled) {
      if (user.mfaAppEnabled) {
        if (!mfaToken) {
          return res.json({ success: true, mfaRequired: true, mfaType: 'app', userId: targetUserId });
        }
        const valid = verifyTotpToken(user.mfaSecret, mfaToken);
        if (!valid) return res.status(400).json({ success: false, message: 'Invalid MFA code' });
      }
      else if (user.mfaEmailEnabled) {
        const code = generateMfaCode();
        await User.update(targetUserId, { mfaCode: code, mfaCodeExpires: Date.now() + 300000 });
        await sendMfaEmail(user, code);
        return res.json({ success: true, mfaRequired: true, mfaType: 'email', userId: targetUserId });
      }
    }

    if (fcmToken) {
      await User.update(targetUserId, { fcmToken });
      user.fcmToken = fcmToken;
    }

    const session = await createLoginSession(user, req);
    const token = jwt.sign(
      { id: targetUserId, role: user.role, sessionId: session._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );

    res.json({
      success: true,
      mfaRequired: false,
      data: {
        id: targetUserId,
        name: user.name,
        role: user.role,
        fcmToken: user.fcmToken || null,
        whatsappNumber: user.whatsappNumber || null,
        whatsappVerified: user.whatsappVerified ?? false,
        permissions: permissionsFor(user),
        token,
        sessionId: session._id,
        sessionExpiresAt: session.expiresAt,
      }
    });

  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, createLoginSession };

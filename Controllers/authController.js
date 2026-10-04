// Controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../Models/User');
const { sanitizeUser } = require('../utils/sanitizeUser');
const crypto = require('crypto');

const Session = require('../Models/Session');


/**
 * Refresh token
 */
async function refreshToken(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    // The new token stays bound to the same server-side session, so revoking
    // the session (logout, password change) also revokes refreshed tokens (SEC-09).
    const sessionId = req.auth?.sessionId;
    if (!sessionId) return res.status(401).json({ success: false, message: 'Please sign in again' });
    const token = jwt.sign(
      { id: req.user._id, role: req.user.role, sessionId },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );
    res.json({ success: true, token, sessionId });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/auth/logout - ends the current session on the server (SEC-10).
 */
async function logout(req, res, next) {
  try {
    const sessionId = req.auth?.sessionId;
    if (sessionId) await Session.revoke(sessionId);
    res.json({ success: true, message: 'Signed out' });
  } catch (err) {
    next(err);
  }
}


async function toggleEmailMfa(req, res, next) {
  try {
    const { enable } = req.body;
    const userId = String(req.user._id || req.user.id);

    await User.update(userId, {
      mfaEmailEnabled: !!enable,
      mfaEnabled: !!enable, // if disabling both, handle separately
    });

    res.json({ success: true, message: `Email-based MFA ${enable ? 'enabled' : 'disabled'}` });
  } catch (err) {
    next(err);
  }
}

async function disableAllMfa(req, res, next) {
  try {
    const userId = String(req.user._id || req.user.id);

    await User.update(userId, {
      mfaEnabled: false,
      mfaEmailEnabled: false,
      mfaAppEnabled: false,
      mfaSecret: null,
      mfaCode: null,
      mfaCodeExpires: null,
    });

    res.json({ success: true, message: 'All MFA disabled' });
  } catch (err) {
    next(err);
  }
}
async function getProfile(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    // Get the user ID from the auth middleware
    const userId = String(req.user._id || req.user.id);

    // Fetch the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Remove password from user object if it exists (DynamoDB items are plain objects)
    const userObj = sanitizeUser(user);

    // Fetch sessions
    const sessions = await Session.findByUserId(userId);

    res.json({
      success: true,
      user: userObj,
      sessions,
    });
  } catch (err) {
    next(err);
  }
}
/**
 * @desc Change password for logged-in user
 * @route POST /api/v1/auth/change-password
 * @access Private (requires JWT)
 */
async function changePassword(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = String(req.user._id || req.user.id);

    // Validate fields
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    // Check current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update in DynamoDB
    await User.update(user._id, {
      password: hashedPassword,
      passwordChangedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Sign out every other device (an attacker's session must not survive) - SEC-10.
    await Session.revokeAllForUser(user._id, req.auth?.sessionId);

    res.json({ success: true, message: 'Password changed successfully. Other devices have been signed out.' });
  } catch (err) {
    console.error('Change password error:', err);
    next(err);
  }
}

async function listSessions(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const sessions = await Session.findByUserId(String(req.user._id));
    res.json({ success: true, sessions });
  } catch (err) {
    next(err);
  }
}

async function revokeSession(req, res, next) {
  try {
    const { id } = req.params;
    const session = await Session.findById(id);
    if (!session || String(session.userId) !== String(req.user._id)) {
      return res.status(404).json({ success: false, message: 'Session not found or forbidden' });
    }
    await Session.revoke(id);
    res.json({ success: true, message: 'Session revoked' });
  } catch (err) {
    next(err);
  }
}

async function revokeAllOtherSessions(req, res, next) {
  try {
    const sessions = await Session.findByUserId(String(req.user._id));
    const currentSessionId = req.auth?.sessionId;

    for (const s of sessions) {
      if (s._id !== currentSessionId) {
        await Session.revoke(s._id);
      }
    }
    res.json({ success: true, message: 'Other sessions revoked' });
  } catch (err) {
    next(err);
  }
}

/**
 * Send WhatsApp Verification OTP
 * POST /api/v1/auth/whatsapp/send-otp
 */
async function sendWhatsappOtp(req, res, next) {
  try {
    const userId = String(req.user.id || req.user._id);
    const { phone } = req.body;

    // Valid 10 digit check
    if (phone && !/^\d{10}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'Invalid phone number format' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Update phone if provided
    let targetPhone = user.whatsappNumber;
    if (phone) {
      targetPhone = phone;
      // Update user's number immediately so we verify THIS number.
      await User.update(userId, { whatsappNumber: phone, whatsappVerified: false, updatedAt: new Date().toISOString() });
    }

    if (!targetPhone) {
      return res.status(400).json({ success: false, message: 'No WhatsApp number found. Please provide one.' });
    }

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const expires = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Save to DB
    await User.update(userId, {
      whatsappOtp: otp,
      whatsappOtpExpires: expires,
      updatedAt: new Date().toISOString()
    });

    // Send Message
    const { sendWhatsAppMessage } = require('../utils/whatsapp');

    // Use buttonParams as tested
    await sendWhatsAppMessage({
      phone: '91' + targetPhone, // Append country code 91 for India
      templateName: 'egspgoi_faculty_credit_system_otp_verify',
      // Text params: creating, GoPay, Merchant Name, OTP, GoPay
      textParams: ['creating', 'Faculty Portal', 'EGSPGOI', otp, 'Faculty Portal'],
      buttonParams: [otp] // For Copy Code button
    });

    res.json({ success: true, message: `OTP sent to ${targetPhone}` });

  } catch (err) {
    next(err);
  }
}

/**
 * Verify WhatsApp OTP
 * POST /api/v1/auth/whatsapp/verify-otp
 */
async function verifyWhatsappOtp(req, res, next) {
  try {
    const userId = String(req.user.id || req.user._id);
    const { otp } = req.body;

    if (!otp) return res.status(400).json({ success: false, message: 'OTP is required' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user.whatsappVerified) {
      return res.json({ success: true, message: 'Already verified' });
    }

    if (!user.whatsappOtp || !user.whatsappOtpExpires) {
      return res.status(400).json({ success: false, message: 'No OTP requested' });
    }

    if (Date.now() > user.whatsappOtpExpires) {
      return res.status(400).json({ success: false, message: 'OTP expired. Request a new one.' });
    }

    if (String(user.whatsappOtp) !== String(otp)) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    // Success
    await User.update(userId, {
      whatsappVerified: true,
      whatsappOtp: null,
      whatsappOtpExpires: null,
      updatedAt: new Date().toISOString()
    });

    res.json({ success: true, message: 'WhatsApp number verified successfully' });

  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProfile,
  changePassword,
  refreshToken,
  logout,
  toggleEmailMfa,
  disableAllMfa,
  listSessions,
  revokeSession,
  revokeAllOtherSessions,
  sendWhatsappOtp,
  verifyWhatsappOtp,
};

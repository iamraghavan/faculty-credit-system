const bcrypt = require('bcryptjs');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const User = require('../Models/User');
const { sanitizeUser } = require('../utils/sanitizeUser');
const { passwordPolicyError } = require('../domain/passwordPolicy');
const { hashCode, codesMatch } = require('../utils/mfaTicket');
const Credit = require('../Models/Credit');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const { handleProfileImageUpload } = require('../utils/uploadProfileImage');

const {
  generateTotpSecret,
  generateTotpQrCode,
  verifyTotpToken,
  generateMfaCode,
  sendMfaEmail,
} = require('../utils/mfa');
const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
const TABLE_NAME = process.env.DYNAMO_DB_USERS;

/**
 * Get current user profile
 */
// Controllers/userController.js
async function getProfile(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const userId = String(req.user._id || req.user.id);
    const params = {
      TableName: TABLE_NAME,
      Key: { _id: userId },
    };

    const result = await ddbDocClient.send(new GetCommand(params));

    // Fallback for users with 'id' as key instead of '_id'
    if (!result.Item) {
      const fallbackParams = {
        TableName: TABLE_NAME,
        Key: { id: userId },
      };
      const fallbackResult = await ddbDocClient.send(new GetCommand(fallbackParams));
      if (fallbackResult.Item) {
        result.Item = fallbackResult.Item;
      }
    }

    if (!result.Item) {
      return res.status(404).json({ success: false, message: 'User profile not found' });
    }

    res.json({ success: true, data: sanitizeUser(result.Item) });
  } catch (err) {
    next(err);
  }
}

/**
 * Update current user profile
 */
async function updateProfile(req, res, next) {
  try {
    const fields = req.fields || req.body || {};
    const allowedFields = ['name', 'phone', 'prefix', 'whatsappNumber'];
    const updates = {};

    for (const field of allowedFields) {
      if (fields[field] !== undefined) updates[field] = fields[field];
    }

    if (updates.whatsappNumber !== undefined) {
      updates.whatsappNumber = String(updates.whatsappNumber).trim();
    }

    // Validate WhatsApp if updated
    if (updates.whatsappNumber && !/^\d{10}$/.test(updates.whatsappNumber)) {
      return res.status(400).json({ success: false, message: 'WhatsApp number must be exactly 10 digits' });
    }

    // A verification belongs to one phone number; changing it invalidates that proof.
    if (updates.whatsappNumber !== undefined && updates.whatsappNumber !== (req.user.whatsappNumber || '')) {
      updates.whatsappVerified = false;
      updates.whatsappOtp = null;
      updates.whatsappOtpExpires = null;
      updates.whatsappOtpAttempts = 0;
    }

    if (req.files?.profileImage) {
      const file = req.files.profileImage;
      updates.profileImage = await handleProfileImageUpload(file);
    }

    // Build UpdateExpression dynamically
    const updateKeys = Object.keys(updates);
    if (!updateKeys.length) return res.status(400).json({ success: false, message: 'No profile changes provided' });
    const updateExpression = `SET ${updateKeys.map((k, i) => `#${k} = :${k}`).join(', ')}`;
    const expressionAttributeNames = Object.fromEntries(updateKeys.map((k) => [`#${k}`, k]));
    const expressionAttributeValues = Object.fromEntries(updateKeys.map((k) => [`:${k}`, updates[k]]));

    const params = {
      TableName: TABLE_NAME,
      Key: { _id: req.user._id || req.user.id },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    };

    const result = await ddbDocClient.send(new UpdateCommand(params));

    res.json({ success: true, data: sanitizeUser(result.Attributes || {}) });
  } catch (err) {
    next(err);
  }
}

/**
 * Change Password
 */
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current and new password are required' });
    }
    const policyError = await passwordPolicyError(newPassword);
    if (policyError) return res.status(400).json({ success: false, message: policyError });

    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(400).json({ success: false, message: 'Current password is incorrect' });

    const hashed = await bcrypt.hash(newPassword, 12);

    await User.update(userId, { password: hashed, passwordChangedAt: new Date().toISOString() });

    // Sign out every other device (SEC-10).
    await require('../Models/Session').revokeAllForUser(userId, req.auth?.sessionId);

    res.json({ success: true, message: 'Password updated successfully. Other devices have been signed out.' });
  } catch (err) {
    next(err);
  }
}

/**
 * Get MFA Setup (App)
 */
async function getMfaSetup(req, res, next) {
  try {
    const user = await User.findById(String(req.user._id || req.user.id));
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.mfaEnabled || user.mfaAppEnabled || user.mfaEmailEnabled) {
      return res
        .status(409)
        .json({ success: false, message: 'Disable the current sign-in method before setting up another one' });
    }
    const type = req.body?.type || req.query?.type || 'app';
    if (type === 'email') {
      const code = generateMfaCode();
      await User.update(user._id, {
        mfaPendingEmailCode: hashCode(code),
        mfaPendingEmailExpiresAt: Date.now() + 5 * 60 * 1000,
        mfaPendingAttempts: 0,
      });
      try {
        await sendMfaEmail(user, code, 'setup');
      } catch (error) {
        return res.status(503).json({
          success: false,
          message: 'Could not send the verification email. Please try again later.',
        });
      }
      return res.json({ success: true, message: 'Verification code sent to your email address' });
    }
    if (type !== 'app') return res.status(400).json({ success: false, message: 'Invalid MFA type' });
    const secret = generateTotpSecret(user.email);
    const qrCode = await generateTotpQrCode(secret);
    await User.update(user._id, {
      mfaPendingSecret: secret.base32,
      mfaPendingExpiresAt: Date.now() + 10 * 60 * 1000,
      mfaPendingAttempts: 0,
    });

    res.json({
      success: true,
      qrCode: qrCode,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Enable MFA
 */
async function enableMfa(req, res, next) {
  try {
    const { type, token } = req.body || {};
    const userId = req.user._id || req.user.id;
    const user = await User.findById(String(userId));
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.mfaEnabled || user.mfaAppEnabled || user.mfaEmailEnabled) {
      return res.status(409).json({ success: false, message: 'An MFA method is already active' });
    }
    if (!/^\d{6}$/.test(String(token || '')))
      return res.status(400).json({ success: false, message: 'A 6-digit verification code is required' });
    if (Number(user.mfaPendingAttempts || 0) >= 5)
      return res.status(429).json({ success: false, message: 'Too many attempts. Start setup again.' });

    if (type === 'app') {
      if (!user.mfaPendingSecret || Number(user.mfaPendingExpiresAt) <= Date.now()) {
        return res.status(400).json({ success: false, message: 'Authenticator setup expired. Start again.' });
      }
      if (!verifyTotpToken(user.mfaPendingSecret, String(token))) {
        await User.update(userId, { mfaPendingAttempts: Number(user.mfaPendingAttempts || 0) + 1 });
        return res.status(400).json({ success: false, message: 'Invalid authenticator code' });
      }

      await User.update(userId, {
        mfaEnabled: true,
        mfaAppEnabled: true,
        mfaSecret: user.mfaPendingSecret,
        mfaEmailEnabled: false,
        mfaPendingSecret: null,
        mfaPendingExpiresAt: null,
        mfaPendingAttempts: 0,
      });
    } else if (type === 'email') {
      if (!user.mfaPendingEmailCode || Number(user.mfaPendingEmailExpiresAt) <= Date.now()) {
        return res.status(400).json({ success: false, message: 'Email verification expired. Start again.' });
      }
      if (!codesMatch(user.mfaPendingEmailCode, token)) {
        await User.update(userId, { mfaPendingAttempts: Number(user.mfaPendingAttempts || 0) + 1 });
        return res.status(400).json({ success: false, message: 'Invalid email verification code' });
      }
      await User.update(userId, {
        mfaEnabled: true,
        mfaEmailEnabled: true,
        mfaAppEnabled: false,
        mfaSecret: null,
        mfaPendingEmailCode: null,
        mfaPendingEmailExpiresAt: null,
        mfaPendingAttempts: 0,
      });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid MFA type' });
    }

    res.json({ success: true, message: `MFA (${type}) enabled successfully` });
  } catch (err) {
    next(err);
  }
}

/**
 * Disable MFA
 */
async function disableMfa(req, res, next) {
  try {
    const { token, currentPassword } = req.body || {};
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(403).json({ success: false, message: 'Current password is required to disable MFA' });
    }

    if (user.mfaAppEnabled && user.mfaSecret) {
      if (!/^\d{6}$/.test(String(token || '')))
        return res.status(400).json({ success: false, message: 'Authenticator code is required to disable MFA' });
      const isValid = verifyTotpToken(user.mfaSecret, token);
      if (!isValid) return res.status(400).json({ success: false, message: 'Invalid token' });
    }

    await User.update(userId, {
      mfaEnabled: false,
      mfaAppEnabled: false,
      mfaEmailEnabled: false,
      mfaSecret: null,
      mfaPendingSecret: null,
      mfaPendingExpiresAt: null,
      mfaPendingEmailCode: null,
      mfaPendingEmailExpiresAt: null,
      mfaPendingAttempts: 0,
    });

    res.json({ success: true, message: 'MFA disabled successfully' });
  } catch (err) {
    next(err);
  }
}

/**
 * Get Active Sessions
 */
async function getSessions(req, res, next) {
  try {
    // In a stateless JWT setup, tracking multiple sessions requires db-backed tokens.
    // For now, we return the current session assuming it is the active one.
    const currentSession = {
      id: req.user.id || req.user._id,
      device: req.headers['user-agent'] || 'Unknown Device',
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'Unknown IP',
      lastActive: new Date().toISOString(),
      isCurrent: true,
    };
    res.json({ success: true, sessions: [currentSession] });
  } catch (err) {
    next(err);
  }
}

/**
 * Export User Data
 */
async function exportUserData(req, res, next) {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const credits = await Credit.find({ faculty: user.facultyID });

    let csvData = `--- USER PROFILE ---\n`;
    csvData += `Faculty ID,Name,Email,Department,Designation\n`;
    csvData += `"${user.facultyID || ''}","${user.name || ''}","${user.email || ''}","${user.department || ''}","${user.designation || ''}"\n\n`;

    csvData += `--- CREDITS DATA ---\n`;
    csvData += `Type,Title,Points,Status,Academic Year,Date\n`;
    (credits || []).forEach((c) => {
      csvData += `"${c.type || ''}","${c.title ? c.title.replace(/"/g, '""') : ''}","${c.points || 0}","${c.status || ''}","${c.academicYear || ''}","${c.createdAt || ''}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="UserData_${user.facultyID || 'Export'}.csv"`);
    res.send(csvData);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  getMfaSetup,
  enableMfa,
  disableMfa,
  getSessions,
  exportUserData,
};

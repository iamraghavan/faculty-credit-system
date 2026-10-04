const bcrypt = require('bcryptjs');
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const User = require('../Models/User');
const { sanitizeUser } = require('../utils/sanitizeUser');
const Credit = require('../Models/Credit');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  ScanCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
const { handleProfileImageUpload } = require('../utils/uploadProfileImage');

const { 
  generateTotpSecret, 
  generateTotpQrCode, 
  verifyTotpToken,
  generateMfaCode,
  sendMfaEmail
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
    const allowedFields = ['name', 'email', 'phone', 'department', 'prefix', 'roleCategory', 'designation', 'whatsappNumber'];
    const updates = {};

    for (const field of allowedFields) {
      if (fields[field] !== undefined) updates[field] = fields[field];
    }

    // Validate WhatsApp if updated
    if (updates.whatsappNumber && !/^\d{10}$/.test(updates.whatsappNumber)) {
      return res.status(400).json({ success: false, message: 'WhatsApp number must be exactly 10 digits' });
    }

    if (req.files?.profileImage) {
      const file = req.files.profileImage;
      updates.profileImage = await handleProfileImageUpload(file);
    }

    // Check if email exists (scan DynamoDB for email)
    if (updates.email && updates.email !== req.user.email) {
      const scanParams = {
        TableName: TABLE_NAME,
        FilterExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': updates.email },
      };
      const scanResult = await ddbDocClient.send(new ScanCommand(scanParams));
      if (scanResult.Count > 0) return res.status(400).json({ success: false, message: 'Email already in use' });
    }

    // Build UpdateExpression dynamically
    const updateKeys = Object.keys(updates);
    const updateExpression = `SET ${updateKeys.map((k, i) => `#${k} = :${k}`).join(', ')}`;
    const expressionAttributeNames = Object.fromEntries(updateKeys.map(k => [`#${k}`, k]));
    const expressionAttributeValues = Object.fromEntries(updateKeys.map(k => [`:${k}`, updates[k]]));

    const params = {
      TableName: TABLE_NAME,
      Key: { _id: req.user._id || req.user.id },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "ALL_NEW",
    };

    const result = await ddbDocClient.send(new UpdateCommand(params));
    
    const attributes = result.Attributes || {};
    delete attributes.password;
    delete attributes.mfaSecret;

    res.json({ success: true, data: attributes });
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

    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(400).json({ success: false, message: 'Current password is incorrect' });

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(newPassword, salt);

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
    const user = req.user;
    const secret = generateTotpSecret(user.email);
    const qrCode = await generateTotpQrCode(secret);

    res.json({
      success: true,
      secret: secret.base32,
      qrCode: qrCode
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
    const { type, token, secret } = req.body; // type: 'app' or 'email'
    const userId = req.user._id || req.user.id;

    if (type === 'app') {
      if (!token || !secret) return res.status(400).json({ success: false, message: 'Token and Secret are required' });
      const isValid = verifyTotpToken(secret, token);
      if (!isValid) return res.status(400).json({ success: false, message: 'Invalid token' });

      await User.update(userId, {
        mfaEnabled: true,
        mfaAppEnabled: true,
        mfaSecret: secret,
        mfaEmailEnabled: false
      });
    } else if (type === 'email') {
      await User.update(userId, {
        mfaEnabled: true,
        mfaEmailEnabled: true,
        mfaAppEnabled: false,
        mfaSecret: null
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
    const { token } = req.body;
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);

    if (user.mfaAppEnabled && user.mfaSecret) {
      if (!token) return res.status(400).json({ success: false, message: 'Token is required to disable' });
      const isValid = verifyTotpToken(user.mfaSecret, token);
      if (!isValid) return res.status(400).json({ success: false, message: 'Invalid token' });
    }

    await User.update(userId, {
      mfaEnabled: false,
      mfaAppEnabled: false,
      mfaEmailEnabled: false,
      mfaSecret: null
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
      isCurrent: true
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
    (credits || []).forEach(c => {
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

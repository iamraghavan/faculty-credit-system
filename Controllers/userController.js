const bcrypt = require('bcryptjs');
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
const { handleProfileImageUpload } = require('../utils/uploadProfileImage');
const { generateFacultyID, generateApiKey } = require('../utils/generateID');

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

    delete result.Item.password;
    res.json({ success: true, data: result.Item });
  } catch (err) {
    next(err);
  }
}


/**
 * Update current user profile
 */
async function updateProfile(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const allowedFields = ['name', 'email', 'phone', 'department', 'prefix', 'roleCategory', 'designation', 'whatsappNumber'];
    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
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
      Key: { id: req.user.id },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "ALL_NEW",
    };

    const result = await ddbDocClient.send(new UpdateCommand(params));
    res.json({ success: true, data: result.Attributes });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: create user
 */
async function adminCreateUser(req, res, next) {
  try {
    const { name, email, password, college, department, role, prefix, roleCategory, designation, whatsappNumber } = req.body;
    if (!name || !email || !college || !password || !roleCategory || !designation)
      return res.status(400).json({ success: false, message: 'Missing required fields' });

    // Check if email exists
    const scanParams = {
      TableName: TABLE_NAME,
      FilterExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
    };
    const scanResult = await ddbDocClient.send(new ScanCommand(scanParams));
    if (scanResult.Count > 0) return res.status(400).json({ success: false, message: 'User already exists' });

    // Validate WhatsApp
    if (whatsappNumber && !/^\d{10}$/.test(whatsappNumber)) {
      return res.status(400).json({ success: false, message: 'WhatsApp number must be exactly 10 digits' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const facultyID = generateFacultyID(college);
    const apiKey = generateApiKey();

    const userData = {
      id: facultyID,
      name,
      email,
      password: hashed,
      college,
      department,
      facultyID,
      apiKey,
      prefix: prefix || 'Mr.',
      whatsappNumber: whatsappNumber || null,
      whatsappVerified: false,
      roleCategory,
      designation,
      role: role === 'admin' ? 'admin' : 'faculty',
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    if (req.files?.profileImage) {
      const file = req.files.profileImage;
      userData.profileImage = await handleProfileImageUpload(file);
    }

    await ddbDocClient.send(new PutCommand({ TableName: TABLE_NAME, Item: userData }));
    delete userData.password; // don't return password
    res.status(201).json({ success: true, data: userData });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: get user by ID
 */
async function getUserById(req, res, next) {
  try {
    const params = { TableName: TABLE_NAME, Key: { id: req.params.id } };
    const result = await ddbDocClient.send(new GetCommand(params));
    if (!result.Item) return res.status(404).json({ success: false, message: 'User not found' });
    delete result.Item.password;
    res.json({ success: true, data: result.Item });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: delete user
 */
async function deleteUser(req, res, next) {
  try {
    const params = { TableName: TABLE_NAME, Key: { id: req.params.id } };
    await ddbDocClient.send(new DeleteCommand(params));
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: update user
 */
async function adminUpdateUser(req, res, next) {
  try {
    const allowedFields = ['name', 'email', 'phone', 'department', 'college', 'role', 'isActive', 'prefix', 'roleCategory', 'designation', 'whatsappNumber', 'whatsappVerified'];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (updates.whatsappNumber && !/^\d{10}$/.test(updates.whatsappNumber)) {
      return res.status(400).json({ success: false, message: 'WhatsApp number must be exactly 10 digits' });
    }

    if (req.files?.profileImage) {
      updates.profileImage = await handleProfileImageUpload(req.files.profileImage);
    }

    if (Object.keys(updates).length === 0) return res.status(400).json({ success: false, message: 'No updates provided' });

    const updateKeys = Object.keys(updates);
    const updateExpression = `SET ${updateKeys.map((k, i) => `#${k} = :${k}`).join(', ')}`;
    const expressionAttributeNames = Object.fromEntries(updateKeys.map(k => [`#${k}`, k]));
    const expressionAttributeValues = Object.fromEntries(updateKeys.map(k => [`:${k}`, updates[k]]));

    const params = {
      TableName: TABLE_NAME,
      Key: { id: req.params.id },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "ALL_NEW",
    };

    const result = await ddbDocClient.send(new UpdateCommand(params));
    if (!result.Attributes) return res.status(404).json({ success: false, message: 'User not found' });
    delete result.Attributes.password;
    res.json({ success: true, data: result.Attributes });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: list users (basic filtering, DynamoDB scan)
 */
async function listUsers(req, res, next) {
  try {
    const { q, department, college, role, isActive } = req.query;

    let filterExpressions = [];
    let expressionAttributeValues = {};
    let expressionAttributeNames = {};

    if (q) {
      filterExpressions.push('contains(#name, :q) OR contains(email, :q) OR contains(facultyID, :q)');
      expressionAttributeValues[':q'] = q;
      expressionAttributeNames['#name'] = 'name';
    }

    if (department) {
      filterExpressions.push('#department = :department');
      expressionAttributeValues[':department'] = department;
      expressionAttributeNames['#department'] = 'department';
    }

    if (college) {
      filterExpressions.push('#college = :college');
      expressionAttributeValues[':college'] = college;
      expressionAttributeNames['#college'] = 'college';
    }

    if (role) {
      filterExpressions.push('#role = :role');
      expressionAttributeValues[':role'] = role;
      expressionAttributeNames['#role'] = 'role';
    }

    if (typeof isActive !== 'undefined') {
      const activeBool = String(isActive).toLowerCase() === 'true';
      filterExpressions.push('#isActive = :isActive');
      expressionAttributeValues[':isActive'] = activeBool;
      expressionAttributeNames['#isActive'] = 'isActive';
    }

    const params = {
      TableName: TABLE_NAME,
    };

    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(' AND ');
      params.ExpressionAttributeValues = expressionAttributeValues;
      params.ExpressionAttributeNames = expressionAttributeNames;
    }

    const result = await ddbDocClient.send(new ScanCommand(params));
    const items = result.Items.map(item => {
      delete item.password;
      return item;
    });

    res.json({ success: true, total: items.length, items });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProfile,
  updateProfile,
  adminCreateUser,
  adminUpdateUser,
  listUsers,
  getUserById,
  deleteUser,
};

const bcrypt = require('bcryptjs');
const User = require('../../Models/User');
const Session = require('../../Models/Session');
const { connectDB } = require('../../config/db');
const { generateFacultyID, generateApiKey } = require('../../utils/generateID');
const { handleProfileImageUpload } = require('../../utils/uploadProfileImage');
const { getSettings, placement } = require('../../domain/applicationSettings');
const { transferChanges, revokeSessions } = require('../../domain/userTransfer');

const ROLES = new Set(['faculty', 'oa', 'admin']);
const EDITABLE = [
  'prefix',
  'name',
  'email',
  'phone',
  'whatsappNumber',
  'college',
  'department',
  'designation',
  'roleCategory',
  'role',
  'isActive',
];
const PUBLIC_FIELDS = [
  '_id',
  'facultyID',
  'prefix',
  'name',
  'email',
  'phone',
  'whatsappNumber',
  'college',
  'department',
  'designation',
  'roleCategory',
  'role',
  'isActive',
  'profileImage',
  'currentCredit',
  'totalPositiveCredit',
  'totalNegativeCredit',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'deactivatedAt',
  'deactivatedBy',
  'reactivatedAt',
  'reactivatedBy',
  'passwordChangedAt',
];
const DIRECTORY_FIELDS = [
  '_id',
  'facultyID',
  'prefix',
  'name',
  'email',
  'college',
  'department',
  'designation',
  'role',
  'isActive',
  'profileImage',
];

function publicUser(user, directory = false) {
  return {
    ...Object.fromEntries(
      (directory
        ? DIRECTORY_FIELDS
        : [...PUBLIC_FIELDS, 'institutionId', 'collegeId', 'departmentId', 'transferHistory']
      )
        .filter((field) => user[field] !== undefined)
        .map((field) => [field, user[field]]),
    ),
    isActive: user.isActive !== false,
  };
}

function fieldsOf(req) {
  return req.fields || req.body || {};
}

function validateRole(actor, target, role) {
  if (!ROLES.has(role)) return 'Role must be faculty, oa, or admin';
  if (target?.role === 'superadmin' && actor.role !== 'superadmin') return 'Only a superadmin can edit a superadmin';
  if (target?.role === 'superadmin' && role !== 'superadmin') return 'Superadmin role cannot be changed here';
  return null;
}

async function createUser(req, res, next) {
  try {
    await connectDB();
    const input = fieldsOf(req);
    const role = String(input.role || 'faculty').toLowerCase();
    const roleError = validateRole(req.user, null, role);
    if (roleError) return res.status(400).json({ success: false, message: roleError });
    const name = String(input.name || '').trim();
    const email = String(input.email || '')
      .trim()
      .toLowerCase();
    const password = String(input.password || '');
    const settings = await getSettings();
    const college = String(input.college || (role === 'faculty' ? '' : 'EGS Pillay Group of Institutions')).trim();
    const department = String(input.department || '').trim();
    if (
      !name ||
      name.length > 200 ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      password.length < settings.passwordMinLength ||
      password.length > 128 ||
      !college ||
      (role === 'faculty' && !department)
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message: `Name, valid email, password of ${settings.passwordMinLength} to 128 characters, college, and faculty department are required`,
        });
    }
    const users = await User.find();
    if (users.some((user) => String(user.email || '').toLowerCase() === email))
      return res.status(409).json({ success: false, message: 'Email already exists' });
    const now = new Date().toISOString();
    const created = await User.create({
      name,
      email,
      password: await bcrypt.hash(password, 12),
      role,
      ...placement(settings, college, department),
      facultyID: generateFacultyID(college),
      apiKey: generateApiKey(),
      prefix: String(input.prefix || 'Mr.').trim(),
      designation: String(input.designation || '').trim(),
      roleCategory: String(input.roleCategory || '').trim(),
      phone: String(input.phone || '').trim(),
      whatsappNumber: String(input.whatsappNumber || '').trim(),
      isActive: true,
      currentCredit: 0,
      totalPositiveCredit: 0,
      totalNegativeCredit: 0,
      creditsByYear: {},
      createdAt: now,
      updatedAt: now,
      createdBy: String(req.user._id),
    });
    return res.status(201).json({ success: true, data: publicUser(created) });
  } catch (error) {
    next(error);
  }
}

async function listUsers(req, res, next) {
  try {
    await connectDB();
    const directory = req.user.role === 'oa';
    const q = String(req.query.q || '')
      .trim()
      .toLowerCase();
    const role = directory
      ? 'faculty'
      : String(req.query.role || '')
          .trim()
          .toLowerCase();
    const college = String(req.query.college || '').trim();
    const department = String(req.query.department || '').trim();
    const institutionId = String(req.query.institutionId || '').trim();
    const settings = institutionId ? await getSettings() : null;
    const active = directory
      ? true
      : req.query.isActive === undefined
        ? null
        : String(req.query.isActive).toLowerCase() === 'true';
    let users = (await User.find()).filter(
      (user) =>
        (!role || user.role === role) &&
        (!college || user.college === college) &&
        (!department || user.department === department) &&
        (active === null || (user.isActive !== false) === active) &&
        (!institutionId ||
          settings.colleges.some((item) => item.name === user.college && item.institutionId === institutionId)) &&
        (!q ||
          [user.name, user.email, user.facultyID].some((value) =>
            String(value || '')
              .toLowerCase()
              .includes(q),
          )),
    );
    users.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const total = users.length;
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 1000));
    const page = Math.max(1, Number(req.query.page) || 1);
    users = users.slice((page - 1) * limit, page * limit);
    return res.json({ success: true, total, page, limit, items: users.map((user) => publicUser(user, directory)) });
  } catch (error) {
    next(error);
  }
}

async function getUser(req, res, next) {
  try {
    await connectDB();
    const user = await User.findById(req.params.id);
    if (!user || (req.user.role === 'oa' && user.role !== 'faculty'))
      return res.status(404).json({ success: false, message: 'User not found' });
    return res.json({ success: true, data: publicUser(user, req.user.role === 'oa') });
  } catch (error) {
    next(error);
  }
}

async function updateUser(req, res, next) {
  try {
    await connectDB();
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });
    if (target.role === 'superadmin' && req.user.role !== 'superadmin')
      return res.status(403).json({ success: false, message: 'Superadmin account is protected' });
    const fields = fieldsOf(req);
    const changes = {};
    for (const field of EDITABLE) if (fields[field] !== undefined) changes[field] = fields[field];
    const changingPlacement =
      (changes.college !== undefined && changes.college !== target.college) ||
      (changes.department !== undefined && changes.department !== (target.department || ''));
    if (changingPlacement)
      return res
        .status(409)
        .json({ success: false, message: 'Use Transfer user to change college or department with an audit history.' });
    if (changes.role !== undefined) {
      changes.role = String(changes.role).toLowerCase();
      const roleError = validateRole(req.user, target, changes.role);
      if (roleError) return res.status(400).json({ success: false, message: roleError });
    }
    if (changes.isActive !== undefined) changes.isActive = String(changes.isActive).toLowerCase() === 'true';
    if (
      String(target._id) === String(req.user._id) &&
      (changes.isActive === false || (changes.role && changes.role !== target.role))
    ) {
      return res.status(409).json({ success: false, message: 'You cannot deactivate or change your own role' });
    }
    if (changes.email !== undefined) {
      changes.email = String(changes.email).trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(changes.email))
        return res.status(400).json({ success: false, message: 'Invalid email' });
      const users = await User.find();
      if (
        users.some(
          (user) => String(user._id) !== String(target._id) && String(user.email || '').toLowerCase() === changes.email,
        )
      )
        return res.status(409).json({ success: false, message: 'Email already exists' });
    }
    if (changes.name !== undefined && !String(changes.name).trim())
      return res.status(400).json({ success: false, message: 'Name is required' });
    if (changes.whatsappNumber && !/^\d{10}$/.test(String(changes.whatsappNumber)))
      return res.status(400).json({ success: false, message: 'WhatsApp number must have 10 digits' });
    if (
      (changes.role || target.role) === 'faculty' &&
      (!(changes.college ?? target.college) || !(changes.department ?? target.department))
    ) {
      return res.status(400).json({ success: false, message: 'Faculty requires college and department' });
    }
    if (req.files?.profileImage) changes.profileImage = await handleProfileImageUpload(req.files.profileImage);
    if (!Object.keys(changes).length) return res.status(400).json({ success: false, message: 'No changes provided' });
    changes.updatedAt = new Date().toISOString();
    changes.updatedBy = String(req.user._id);
    if (
      target.employment?.current &&
      (changes.designation !== undefined ||
        (changes.isActive !== undefined && changes.isActive !== (target.isActive !== false)))
    ) {
      const previous = target.employment.current;
      changes.employment = {
        current: {
          ...previous,
          ...(changes.designation !== undefined ? { designation: changes.designation } : {}),
          ...(changes.isActive !== undefined && changes.isActive !== (target.isActive !== false)
            ? { status: changes.isActive ? 'active' : 'inactive' }
            : {}),
        },
        history: [
          ...(target.employment.history || []),
          {
            ...previous,
            replacedAt: changes.updatedAt,
            replacedBy: changes.updatedBy,
            reason: 'Account details updated',
          },
        ],
      };
      changes.profileVersion = Number(target.profileVersion || 1) + 1;
    }
    if (changes.isActive === false && target.isActive !== false) {
      changes.deactivatedAt = changes.updatedAt;
      changes.deactivatedBy = changes.updatedBy;
    }
    if (changes.isActive === true && target.isActive === false) {
      changes.reactivatedAt = changes.updatedAt;
      changes.reactivatedBy = changes.updatedBy;
    }
    await User.updateCompared(target, changes);
    if ((changes.role && changes.role !== target.role) || changes.isActive === false) await revokeSessions(target._id);
    const updated = await User.findById(String(target._id));
    return res.json({ success: true, data: publicUser(updated) });
  } catch (error) {
    next(error);
  }
}

async function deactivateUser(req, res, next) {
  try {
    await connectDB();
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });
    if (String(target._id) === String(req.user._id))
      return res.status(409).json({ success: false, message: 'You cannot deactivate your own account' });
    if (target.role === 'superadmin')
      return res.status(403).json({ success: false, message: 'Superadmin account is protected' });
    if (target.isActive === false)
      return res.json({ success: true, data: publicUser(target), message: 'Account already inactive' });
    await User.updateCompared(target, {
      isActive: false,
      updatedAt: new Date().toISOString(),
      deactivatedAt: new Date().toISOString(),
      deactivatedBy: String(req.user._id),
    });
    await revokeSessions(target._id);
    const updated = await User.findById(String(target._id));
    return res.json({ success: true, data: publicUser(updated), message: 'Account deactivated; data preserved' });
  } catch (error) {
    next(error);
  }
}

async function resetUserPassword(req, res, next) {
  try {
    await connectDB();
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });
    if (target.role === 'superadmin')
      return res.status(403).json({ success: false, message: 'Superadmin account is protected' });
    const password = String(req.body?.password || '');
    const settings = await getSettings();
    if (password.length < settings.passwordMinLength || password.length > 128)
      return res
        .status(400)
        .json({ success: false, message: `Password must contain ${settings.passwordMinLength} to 128 characters` });
    const now = new Date().toISOString();
    await User.update(String(target._id), {
      password: await bcrypt.hash(password, 12),
      passwordChangedAt: now,
      updatedAt: now,
      updatedBy: String(req.user._id),
    });
    const sessions = await Session.findByUserId(String(target._id));
    await Promise.all(sessions.map((session) => Session.revoke(session._id)));
    return res.json({ success: true, message: 'Password reset and active sessions revoked' });
  } catch (error) {
    next(error);
  }
}

async function transferUser(req, res, next) {
  try {
    if (!req.body || typeof req.body !== 'object')
      return res.status(400).json({ success: false, message: 'Transfer details are required' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (req.body.expectedUpdatedAt !== user.updatedAt)
      return res.status(409).json({ success: false, message: 'User changed. Reload before transferring.' });
    const changes = await transferChanges(user, req.body, req.user);
    const updated = await User.updateCompared(user, changes);
    await revokeSessions(user._id);
    res.json({ success: true, data: publicUser(updated), message: 'User transferred. Previous sessions revoked.' });
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException')
      return res.status(409).json({ success: false, message: 'User changed. Reload before transferring.' });
    next(error);
  }
}

module.exports = {
  publicUser,
  createUser,
  listUsers,
  getUser,
  updateUser,
  deactivateUser,
  resetUserPassword,
  transferUser,
};

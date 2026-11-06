const User = require('../Models/User');
const { professionalProfileSchema, employmentSchema } = require('../utils/facultyProfileSchema');
const { getSettings, placement } = require('../domain/applicationSettings');

function cleanUser(user) {
  if (!user) return null;
  const {
    password,
    apiKey,
    mfaSecret,
    mfaPendingSecret,
    mfaCode,
    resetPasswordToken,
    resetPasswordExpires,
    whatsappOtp,
    ...safe
  } = user;
  return safe;
}

async function loadFaculty(id) {
  const user = await User.findById(String(id));
  if (!user) {
    const error = new Error('Faculty profile not found');
    error.status = 404;
    throw error;
  }
  return user;
}

function profileResponse(user) {
  return {
    identity: {
      id: user._id || user.id,
      facultyID: user.facultyID || user.employment?.current?.employeeId || '',
      prefix: user.prefix || '',
      name: user.name || '',
      email: user.email || '',
      phone: user.phone || '',
    },
    employment: user.employment || {
      current: {
        employeeId: user.facultyID || '',
        college: user.college || '',
        department: user.department || '',
        designation: user.designation || '',
        status: user.isActive === false ? 'inactive' : 'active',
      },
      history: [],
    },
    professional: user.professional || {},
    profileVersion: user.profileVersion || 1,
    updatedAt: user.updatedAt || null,
  };
}

async function getOwnProfessionalProfile(req, res, next) {
  try {
    const user = await loadFaculty(req.user._id || req.user.id);
    res.json({ success: true, data: profileResponse(user) });
  } catch (error) {
    next(error);
  }
}

async function getFacultyProfessionalProfile(req, res, next) {
  try {
    const user = await loadFaculty(req.params.id);
    res.json({ success: true, data: profileResponse(cleanUser(user)) });
  } catch (error) {
    next(error);
  }
}

async function updateOwnProfessionalProfile(req, res, next) {
  try {
    const { error, value } = professionalProfileSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error)
      return res.status(400).json({ success: false, message: error.details.map((item) => item.message).join('; ') });
    const userId = String(req.user._id || req.user.id);
    const current = await loadFaculty(userId);
    const professional = { ...(current.professional || {}), ...value };
    const updatedAt = new Date().toISOString();
    await User.update(userId, { professional, profileVersion: Number(current.profileVersion || 1) + 1, updatedAt });
    res.json({ success: true, data: profileResponse({ ...current, professional, updatedAt }) });
  } catch (error) {
    next(error);
  }
}

async function updateFacultyEmployment(req, res, next) {
  try {
    const { error, value } = employmentSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error)
      return res.status(400).json({ success: false, message: error.details.map((item) => item.message).join('; ') });
    const user = await loadFaculty(req.params.id);
    if (value.college !== user.college || value.department !== user.department) {
      return res.status(409).json({ success: false, message: 'Use Transfer user to change college or department.' });
    }
    placement(await getSettings(), value.college, value.department, { allowInactive: true });
    const now = new Date().toISOString();
    const previous = user.employment?.current;
    const history = [...(user.employment?.history || [])];
    if (previous && JSON.stringify(previous) !== JSON.stringify(value)) {
      history.push({ ...previous, replacedAt: now, replacedBy: String(req.user._id || req.user.id) });
    }
    const employment = { current: value, history };
    const mirrored = {
      facultyID: value.employeeId,
      college: value.college,
      department: value.department,
      designation: value.designation,
      isActive: value.status === 'active' || value.status === 'leave',
    };
    await User.updateCompared(user, {
      employment,
      ...mirrored,
      profileVersion: Number(user.profileVersion || 1) + 1,
      updatedAt: now,
    });
    res.json({ success: true, data: profileResponse({ ...user, employment, ...mirrored, updatedAt: now }) });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getOwnProfessionalProfile,
  getFacultyProfessionalProfile,
  updateOwnProfessionalProfile,
  updateFacultyEmployment,
};

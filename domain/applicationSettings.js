const Joi = require('joi');
const Settings = require('../Models/ApplicationSettings');
const User = require('../Models/User');
const catalog = require('../config/organization-defaults.json');

const id = Joi.string()
  .pattern(/^[a-zA-Z0-9_-]{1,100}$/)
  .required();
const name = Joi.string().trim().min(1).max(250).required();
const date = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .custom((value, helpers) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
      ? value
      : helpers.error('any.invalid');
  })
  .required();
const unit = { id, name, code: Joi.string().trim().max(30).allow('').default(''), active: Joi.boolean().required() };
const schema = Joi.object({
  revision: Joi.number().integer().min(0).required(),
  organizationName: name,
  supportEmail: Joi.string()
    .email({ tlds: { allow: false } })
    .allow('')
    .required(),
  passwordMinLength: Joi.number().integer().min(12).max(128).required(),
  transfersEnabled: Joi.boolean().required(),
  requireTransferReason: Joi.boolean().required(),
  institutions: Joi.array().items(Joi.object(unit)).min(1).max(100).required(),
  colleges: Joi.array()
    .items(
      Joi.object({ ...unit, institutionId: id, departments: Joi.array().items(Joi.object(unit)).max(500).required() }),
    )
    .max(500)
    .required(),
  academicYears: Joi.array()
    .items(
      Joi.object({
        id: Joi.string()
          .pattern(/^\d{4}-\d{2}$/)
          .required(),
        startDate: date,
        endDate: date,
        status: Joi.string().valid('open', 'closed').required(),
      }),
    )
    .min(1)
    .max(100)
    .required(),
  currentAcademicYear: Joi.string().required(),
}).required();

function currentYear() {
  const date = new Date();
  const year = date.getMonth() >= 5 ? date.getFullYear() : date.getFullYear() - 1;
  return `${year}-${String(year + 1).slice(-2)}`;
}

async function getSettings() {
  const saved = await Settings.get();
  if (saved) return saved;
  const colleges = Object.entries(catalog).map(([college, groups], index) => ({
    id: `college-${index + 1}`,
    name: college,
    code: '',
    active: true,
    institutionId: 'egsp',
    departments: [...new Set(Object.values(groups).flat())].map((department, i) => ({
      id: `department-${index + 1}-${i + 1}`,
      name: department,
      code: '',
      active: true,
    })),
  }));
  // Include existing placements without changing or silently dropping legacy users.
  for (const user of (await User.find()).sort((a, b) =>
    `${a.college}/${a.department}`.localeCompare(`${b.college}/${b.department}`),
  )) {
    if (!user.college) continue;
    let college = colleges.find((item) => item.name === user.college);
    if (!college) {
      college = {
        id: `legacy-college-${colleges.length + 1}`,
        name: user.college,
        code: '',
        active: true,
        institutionId: 'egsp',
        departments: [],
      };
      colleges.push(college);
    }
    if (user.department && !college.departments.some((item) => item.name === user.department)) {
      college.departments.push({
        id: `legacy-department-${college.departments.length + 1}`,
        name: user.department,
        code: '',
        active: true,
      });
    }
  }
  const start = Number(currentYear().slice(0, 4));
  return {
    revision: 0,
    organizationName: 'E.G.S. Pillay Group of Institutions',
    supportEmail: '',
    passwordMinLength: 12,
    transfersEnabled: true,
    requireTransferReason: true,
    institutions: [{ id: 'egsp', name: 'E.G.S. Pillay Group of Institutions', code: 'EGSP', active: true }],
    colleges,
    currentAcademicYear: currentYear(),
    academicYears: Array.from({ length: 5 }, (_, index) => ({
      id: `${start - index}-${String(start - index + 1).slice(-2)}`,
      startDate: `${start - index}-06-01`,
      endDate: `${start - index + 1}-05-31`,
      status: 'open',
    })),
    audit: [],
  };
}

function unique(items, field) {
  return new Set(items.map((item) => String(item[field]).toLowerCase())).size === items.length;
}

function validateSettings(input) {
  const result = schema.validate(input, { abortEarly: false });
  if (result.error)
    throw Object.assign(new Error(result.error.details.map((item) => item.message).join('; ')), { status: 400 });
  const value = result.value;
  const fail = (message) => {
    throw Object.assign(new Error(message), { status: 400 });
  };
  for (const items of [
    value.institutions,
    value.colleges,
    value.academicYears,
    ...value.colleges.map((college) => college.departments),
  ]) {
    if (!unique(items, 'id')) fail('Identifiers must be unique within each list');
    if (items[0]?.name && !unique(items, 'name')) fail('Names must be unique within each list');
  }
  for (const college of value.colleges) {
    const parent = value.institutions.find((item) => item.id === college.institutionId);
    if (!parent || (college.active && !parent.active)) fail('Active colleges require an active parent institution');
  }
  for (const year of value.academicYears) {
    const start = Number(year.id.slice(0, 4));
    if (
      year.id !== `${start}-${String(start + 1).slice(-2)}` ||
      year.startDate >= year.endDate ||
      !year.startDate.startsWith(String(start)) ||
      !year.endDate.startsWith(String(start + 1))
    )
      fail('Academic years require consecutive years and valid start/end dates');
  }
  const sorted = [...value.academicYears].sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (sorted.some((year, index) => index && year.startDate <= sorted[index - 1].endDate))
    fail('Academic year dates cannot overlap');
  if (!value.academicYears.some((year) => year.id === value.currentAcademicYear && year.status === 'open'))
    fail('The current academic year must be open');
  return value;
}

function placement(settings, collegeName, departmentName, { allowInactive = false } = {}) {
  const college = settings.colleges.find((item) => item.name === collegeName);
  const institution = settings.institutions.find((item) => item.id === college?.institutionId);
  const department = college?.departments.find((item) => item.name === departmentName);
  if (
    !college ||
    !institution ||
    (departmentName && !department) ||
    (!allowInactive && (!college.active || !institution.active || (department && !department.active)))
  ) {
    throw Object.assign(new Error('Select a valid active institution, college, and department'), { status: 400 });
  }
  return {
    institutionId: institution.id,
    collegeId: college.id,
    departmentId: department?.id || '',
    college: college.name,
    department: department?.name || '',
  };
}

module.exports = { getSettings, validateSettings, placement };

/** Idempotent migration for the Engineering College department directory. */
require('dotenv').config();
const { connectDB } = require('../config/db');
const Settings = require('../Models/ApplicationSettings');
const { getSettings, validateSettings } = require('../domain/applicationSettings');

const collegeName = 'EGS Pillay Engineering College';
const additions = [
  { id: 'department-engineering-aiml', name: 'Artificial Intelligence and Machine Learning', code: '', active: true },
  { id: 'department-engineering-science-humanities', name: 'Science & Humanities', code: '', active: true },
];
const apply = process.argv.includes('--apply');

async function run() {
  await connectDB();
  const saved = await Settings.get();
  const current = saved || (await getSettings());
  const college = current.colleges.find((item) => item.name === collegeName);
  if (!college) throw new Error(`College not found: ${collegeName}`);
  const missing = additions.filter(
    (addition) => !college.departments.some((item) => item.name.toLowerCase() === addition.name.toLowerCase()),
  );
  if (saved && !missing.length) {
    console.log('Both departments already exist in saved application settings.');
    return;
  }
  const usedIds = new Set(college.departments.map((item) => item.id));
  for (const addition of missing) {
    if (usedIds.has(addition.id)) throw new Error(`Department identifier already in use: ${addition.id}`);
  }
  const nextColleges = current.colleges.map((item) =>
    item.id === college.id ? { ...item, departments: [...item.departments, ...missing] } : item,
  );
  const fields = [
    'revision',
    'organizationName',
    'supportEmail',
    'passwordMinLength',
    'transfersEnabled',
    'requireTransferReason',
    'institutions',
    'academicYears',
    'currentAcademicYear',
  ];
  const payload = Object.fromEntries(fields.map((field) => [field, current[field]]));
  payload.colleges = nextColleges;
  const validated = validateSettings(payload);
  if (!apply) {
    console.log(
      JSON.stringify({ savedSettingsExist: Boolean(saved), departmentsToAdd: missing.map((item) => item.name) }),
    );
    return;
  }
  const now = new Date().toISOString();
  await Settings.save(
    {
      ...validated,
      updatedAt: now,
      updatedBy: 'system',
      audit: [
        ...(current.audit || []),
        { at: now, by: 'system', actor: 'Department setup', fields: ['colleges'] },
      ].slice(-100),
    },
    current.revision,
  );
  console.log(JSON.stringify({ saved: true, departmentsPresent: additions.map((item) => item.name) }));
}

run().catch((error) => {
  console.error(`Department migration failed: ${error.name || error.message}`);
  process.exitCode = 1;
});

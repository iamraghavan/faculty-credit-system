const { setupApp, teardownApp, tokens, api, auth, tokenFor } = require('../helpers/app');
const db = require('../helpers/db');
const User = require('../../Models/User');
const CreditPolicy = require('../../Models/CreditPolicy');

let T;
let initial;
const payload = (settings) => {
  const {
    revision,
    organizationName,
    supportEmail,
    passwordMinLength,
    transfersEnabled,
    requireTransferReason,
    institutions,
    colleges,
    academicYears,
    currentAcademicYear,
  } = settings;
  return {
    revision,
    organizationName,
    supportEmail,
    passwordMinLength,
    transfersEnabled,
    requireTransferReason,
    institutions,
    colleges,
    academicYears,
    currentAcademicYear,
  };
};
const read = async () => (await api().get('/api/v1/settings').set(auth(T.admin))).body.data;
const save = (data) => api().put('/api/v1/settings').set(auth(T.admin)).send(data);
const transfer = async (id, changes) => {
  const user = await User.findById(id);
  return api()
    .post(`/api/v1/users/${id}/transfer`)
    .set(auth(T.admin))
    .send({ expectedUpdatedAt: user.updatedAt, ...changes });
};

beforeAll(async () => {
  await setupApp();
  T = await tokens();
  initial = await read();
});
afterAll(() => teardownApp());

test('configuration requires login and only administrators can save', async () => {
  expect((await api().get('/api/v1/settings')).status).toBe(401);
  expect((await api().put('/api/v1/settings').set(auth(T.faculty)).send(payload(initial))).status).toBe(403);
  expect(
    initial.colleges.some(
      (college) =>
        college.name === 'EGS Pillay Engineering College' && college.departments.some((item) => item.name === 'CSE'),
    ),
  ).toBe(true);
});

test('saves nested hierarchy, rejects stale settings and hides audit from faculty', async () => {
  const input = payload(initial);
  input.institutions.push({ id: 'new-institution', name: 'Test institution', code: 'TEST', active: true });
  input.colleges.push({
    id: 'new-college',
    institutionId: 'new-institution',
    name: 'Transfer destination',
    code: 'DEST',
    active: true,
    departments: [
      { id: 'new-department', name: 'Information Technology', code: 'IT', active: true },
      { id: 'archived-department', name: 'Archived', code: '', active: false },
    ],
  });
  const saved = await save(input);
  expect(saved.status).toBe(200);
  expect(saved.body.data.revision).toBe(1);
  expect(saved.body.data.academicYears[0].startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect((await save(input)).status).toBe(409);
  expect((await api().get('/api/v1/settings').set(auth(T.faculty))).body.data.audit).toBeUndefined();
  expect((await CreditPolicy.find()).some((item) => item._id === 'application-settings')).toBe(false);
});

test('rejects invalid hierarchy, overlaps, and removal of occupied departments', async () => {
  let input = payload(await read());
  input.colleges[0].institutionId = 'missing';
  expect((await save(input)).status).toBe(400);
  input = payload(await read());
  input.academicYears[0].endDate = `${Number(input.academicYears[0].id.slice(0, 4)) + 1}-12-31`;
  input.academicYears.push({
    id: `${Number(input.academicYears[0].id.slice(0, 4)) + 1}-${String(Number(input.academicYears[0].id.slice(0, 4)) + 2).slice(-2)}`,
    startDate: `${Number(input.academicYears[0].id.slice(0, 4)) + 1}-06-01`,
    endDate: `${Number(input.academicYears[0].id.slice(0, 4)) + 2}-05-31`,
    status: 'open',
  });
  expect((await save(input)).status).toBe(400);
  input = payload(await read());
  input.colleges.find((item) => item.name === 'EGS Pillay Engineering College').departments = [];
  expect((await save(input)).status).toBe(409);
});

test('transfers preserve identity and credits, synchronize employment, record history, revoke sessions', async () => {
  const before = await User.findById(db.ID.faculty1);
  const res = await transfer(db.ID.faculty1, {
    college: 'Transfer destination',
    department: 'Information Technology',
    reason: 'Inter-college transfer',
  });
  expect(res.status).toBe(200);
  const after = await User.findById(db.ID.faculty1);
  expect(after.facultyID).toBe(before.facultyID);
  expect(after.currentCredit).toBe(before.currentCredit);
  expect(after.creditsByYear).toEqual(before.creditsByYear);
  expect(after.institutionId).toBe('new-institution');
  expect(after.employment.current.department).toBe('Information Technology');
  expect(after.employment.history[0].department).toBe(before.department);
  expect(after.transferHistory[0].reason).toBe('Inter-college transfer');
  expect(res.body.data.password).toBeUndefined();
  expect((await api().get('/api/v1/users/me').set(auth(T.faculty))).status).toBe(401);
  expect(
    (await api().get('/api/v1/users?institutionId=new-institution').set(auth(T.admin))).body.items.map(
      (item) => item._id,
    ),
  ).toContain(db.ID.faculty1);
});

test('transfer rejects unauthorized, stale, invalid, same and protected placements', async () => {
  const route = `/api/v1/users/${db.ID.faculty2}/transfer`;
  expect((await api().post(route).set(auth(T.oa)).send({})).status).toBe(403);
  expect((await api().post(route).set(auth(T.admin)).send({ expectedUpdatedAt: 'stale' })).status).toBe(409);
  expect(
    (await transfer(db.ID.faculty2, { college: 'Transfer destination', department: 'Archived', reason: 'Test' }))
      .status,
  ).toBe(400);
  expect(
    (await transfer(db.ID.faculty2, { college: 'Transfer destination', department: 'Information Technology' })).status,
  ).toBe(400);
  expect(
    (
      await transfer(db.ID.faculty2, {
        college: 'EGS Pillay Engineering College',
        department: 'CSE',
        reason: 'No change',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await transfer(db.ID.superadmin, {
        college: 'Transfer destination',
        department: 'Information Technology',
        reason: 'Test',
      })
    ).status,
  ).toBe(403);
});

test('account edits keep transferred employment designation and status synchronized', async () => {
  const path = `/api/v1/users/${db.ID.faculty1}`;
  expect((await api().put(path).set(auth(T.admin)).field('designation', 'Associate Professor')).status).toBe(200);
  let user = await User.findById(db.ID.faculty1);
  expect(user.employment.current.designation).toBe('Associate Professor');
  expect((await api().put(path).set(auth(T.admin)).field('isActive', 'false')).status).toBe(200);
  user = await User.findById(db.ID.faculty1);
  expect(user.employment.current.status).toBe('inactive');
  expect((await api().put(path).set(auth(T.admin)).field('isActive', 'true')).status).toBe(200);
  expect((await User.findById(db.ID.faculty1)).employment.current.status).toBe('active');
});

test('direct placement changes cannot bypass transfer workflow and concurrent writes cannot lose history', async () => {
  expect(
    (await api().put(`/api/v1/users/${db.ID.faculty2}`).set(auth(T.admin)).field('department', 'Other')).status,
  ).toBe(409);
  const before = await User.findById(db.ID.faculty2);
  await User.updateCompared(before, { updatedAt: new Date(Date.now() + 1000).toISOString(), department: 'CSE' });
  await expect(User.updateCompared(before, { department: 'Other' })).rejects.toMatchObject({
    name: 'ConditionalCheckFailedException',
  });
});

test('server enforces transfer switch and configured password length', async () => {
  const input = payload(await read());
  input.transfersEnabled = false;
  input.passwordMinLength = 20;
  expect((await save(input)).status).toBe(200);
  expect(
    (
      await transfer(db.ID.faculty2, {
        college: 'Transfer destination',
        department: 'Information Technology',
        reason: 'Test',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await api()
        .post(`/api/v1/users/${db.ID.faculty2}/reset-password`)
        .set(auth(T.admin))
        .send({ password: 'Twelve-Char-123' })
    ).status,
  ).toBe(400);
  expect(
    (
      await api()
        .post('/api/v1/auth/register')
        .set(auth(T.admin))
        .send({
          name: 'New user',
          email: 'new@example.org',
          password: 'Twelve-Char-123',
          college: 'Transfer destination',
          department: 'Information Technology',
        })
    ).status,
  ).toBe(400);
});

test('spreadsheet import applies managed placement and password rules and returns row summaries', async () => {
  const XLSX = require('xlsx');
  const workbook = XLSX.utils.book_new();
  const rows = [
    {
      name: 'Imported faculty',
      email: 'imported@example.org',
      password: 'Long-Temporary-Password-123',
      college: 'Transfer destination',
      department: 'Information Technology',
      role: 'faculty',
    },
    {
      name: 'Invalid faculty',
      email: 'invalid@example.org',
      password: 'Long-Temporary-Password-123',
      college: 'Transfer destination',
      department: 'Unknown department',
      role: 'faculty',
    },
    {
      name: 'Short password',
      email: 'short@example.org',
      password: 'Short-Pass-123',
      college: 'Transfer destination',
      department: 'Information Technology',
      role: 'faculty',
    },
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Users');
  const res = await api()
    .post('/api/v1/auth/users/bulk-upload')
    .set(auth(T.admin))
    .attach('file', XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), 'users.xlsx');
  expect(res.status).toBe(200);
  expect(res.body.summary).toEqual({ total: 3, success: 1, failed: 2 });
  expect((await User.find({ email: 'imported@example.org' }))[0].institutionId).toBe('new-institution');
});

test('closing academic year blocks faculty and admin submissions while retaining reports', async () => {
  const input = payload(await read());
  const closed = input.academicYears.find((year) => year.id !== input.currentAcademicYear);
  closed.status = 'closed';
  expect((await save(input)).status).toBe(200);
  const facultyToken = await tokenFor(db.ID.faculty1, 'faculty');
  expect(
    (
      await api()
        .post('/api/v1/credits/credits/positive')
        .set(auth(facultyToken))
        .send({ academicYear: closed.id, title: 'Test', points: 10 })
    ).status,
  ).toBe(409);
  expect(
    (
      await api()
        .post('/api/v1/admin/credits/positive')
        .set(auth(T.admin))
        .send({ academicYear: closed.id, facultyId: db.ID.faculty1, points: 10 })
    ).status,
  ).toBe(409);
  const legacyLabel = `${closed.id.slice(0, 4)}-${Number(closed.id.slice(0, 4)) + 1}`;
  expect(
    (
      await api()
        .post('/api/v1/admin/credits/positive')
        .set(auth(T.admin))
        .send({ academicYear: legacyLabel, facultyId: db.ID.faculty1, points: 10 })
    ).status,
  ).toBe(409);
  expect((await api().get(`/api/v1/users/${db.ID.faculty1}`).set(auth(T.admin))).status).toBe(200);
});

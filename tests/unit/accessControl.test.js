jest.mock('../../Models/Credit', () => ({ findById: jest.fn(), updateOwned: jest.fn() }));
jest.mock('../../Models/CreditTitle', () => ({ findById: jest.fn() }));
jest.mock('../../Models/User', () => ({
  findById: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  updateCompared: jest.fn(),
}));
jest.mock('../../Models/Session', () => ({ findByUserId: jest.fn(), revoke: jest.fn() }));
jest.mock('../../config/db', () => ({ connectDB: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../domain/applicationSettings', () => ({
  getSettings: jest.fn().mockResolvedValue({ passwordMinLength: 12 }),
  placement: jest.fn().mockReturnValue({
    institutionId: 'egsp',
    collegeId: 'engineering',
    departmentId: 'mba',
    college: 'Engineering',
    department: 'MBA',
  }),
}));
jest.mock('../../utils/calculateCredits', () => ({ recalcFacultyCredits: jest.fn().mockResolvedValue({}) }));
jest.mock('../../utils/fileUpload', () => ({ handleFileUpload: jest.fn() }));

const Credit = require('../../Models/Credit');
const CreditTitle = require('../../Models/CreditTitle');
const User = require('../../Models/User');
const Session = require('../../Models/Session');
const { recalcFacultyCredits } = require('../../utils/calculateCredits');
const { permissionsFor, hasPermission } = require('../../config/permissions');
const { updateOwnIssuedCredit, voidOwnIssuedCredit } = require('../../Controllers/oaCreditController');
const {
  publicUser,
  createUser,
  listUsers,
  getUser,
  deactivateUser,
  resetUserPassword,
} = require('../../Controllers/Admin/UserManagementController');
const { requirePermission } = require('../../Middleware/authMiddleware');
const { sanitizeUser } = require('../../utils/sanitizeUser');

const baseCredit = {
  _id: 'credit-1',
  faculty: 'faculty-1',
  issuedBy: 'oa-1',
  type: 'negative',
  title: 'Violation',
  points: -5,
  status: 'pending',
  updatedAt: '2026-09-28T00:00:00.000Z',
};
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });

beforeEach(() => {
  jest.clearAllMocks();
  Credit.findById.mockResolvedValue(baseCredit);
  Credit.updateOwned.mockResolvedValue({ ...baseCredit, status: 'deleted' });
  Session.findByUserId.mockResolvedValue([]);
});

test('OA role cannot acquire admin rights through stored permission overrides', () => {
  const user = { role: 'oa', permissionOverrides: ['credit.read:any', 'user.update', '*'] };
  expect(permissionsFor(user)).toContain('credit.read:own-issued');
  expect(hasPermission(user, 'credit.read:any')).toBe(false);
  expect(hasPermission(user, 'user.update')).toBe(false);
});

test('OA cannot enter admin user creation', () => {
  const res = response();
  const next = jest.fn();
  requirePermission('user.create')({ user: { _id: 'oa-1', role: 'oa' } }, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
});

test('admin creation stores a faculty account and returns no credentials', async () => {
  User.find.mockResolvedValue([]);
  User.create.mockImplementation(async (data) => ({ _id: 'faculty-3', ...data }));
  const res = response();
  res.status = jest.fn().mockReturnThis();
  await createUser(
    {
      user: { _id: 'admin-1', role: 'admin' },
      fields: {
        name: 'New Faculty',
        email: 'new@example.edu',
        password: 'secure-password-123',
        role: 'faculty',
        college: 'Engineering',
        department: 'MBA',
      },
    },
    res,
    jest.fn(),
  );
  expect(res.status).toHaveBeenCalledWith(201);
  expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ role: 'faculty', createdBy: 'admin-1' }));
  expect(res.json.mock.calls[0][0].data).not.toHaveProperty('password');
  expect(res.json.mock.calls[0][0].data).not.toHaveProperty('apiKey');
});

test('account directory responses never expose credentials or MFA secrets', () => {
  const account = {
    _id: 'faculty-1',
    role: 'faculty',
    name: 'Asha',
    email: 'asha@example.edu',
    password: 'hash',
    apiKey: 'secret',
    mfaSecret: 'secret',
    resetPasswordToken: 'secret',
  };
  expect(publicUser(account)).toMatchObject({ _id: 'faculty-1', name: 'Asha', isActive: true });
  for (const field of ['password', 'apiKey', 'mfaSecret', 'resetPasswordToken']) {
    expect(publicUser(account)).not.toHaveProperty(field);
    expect(publicUser(account, true)).not.toHaveProperty(field);
    expect(sanitizeUser(account)).not.toHaveProperty(field);
  }
});

test('OA directory lists active faculty only and hides staff accounts', async () => {
  User.find.mockResolvedValue([
    { _id: 'faculty-1', role: 'faculty', isActive: true, name: 'Asha', email: 'asha@example.edu', password: 'hash' },
    { _id: 'faculty-2', role: 'faculty', isActive: false, name: 'Bina' },
    { _id: 'oa-2', role: 'oa', isActive: true, name: 'Other OA' },
  ]);
  const res = response();
  await listUsers({ user: { _id: 'oa-1', role: 'oa' }, query: {} }, res, jest.fn());
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ total: 1, items: [expect.objectContaining({ _id: 'faculty-1', role: 'faculty' })] }),
  );
  expect(res.json.mock.calls[0][0].items[0]).not.toHaveProperty('password');
});

test('OA cannot fetch another OA account through the user detail route', async () => {
  User.findById.mockResolvedValue({ _id: 'oa-2', role: 'oa', name: 'Other OA' });
  const res = response();
  await getUser({ user: { _id: 'oa-1', role: 'oa' }, params: { id: 'oa-2' } }, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(404);
});

test('deactivating an account preserves its user record', async () => {
  User.findById
    .mockResolvedValueOnce({ _id: 'faculty-1', role: 'faculty', isActive: true })
    .mockResolvedValueOnce({ _id: 'faculty-1', role: 'faculty', isActive: false });
  User.updateCompared.mockResolvedValue({});
  const res = response();
  await deactivateUser({ user: { _id: 'admin-1', role: 'admin' }, params: { id: 'faculty-1' } }, res, jest.fn());
  expect(User.updateCompared).toHaveBeenCalledWith(
    expect.objectContaining({ _id: 'faculty-1' }),
    expect.objectContaining({ isActive: false }),
  );
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});

test('password reset revokes existing sessions and returns no password', async () => {
  User.findById.mockResolvedValue({ _id: 'faculty-1', role: 'faculty' });
  User.update.mockResolvedValue({});
  Session.findByUserId.mockResolvedValue([{ _id: 'session-1' }]);
  Session.revoke.mockResolvedValue({});
  const res = response();
  await resetUserPassword(
    { user: { _id: 'admin-1', role: 'admin' }, params: { id: 'faculty-1' }, body: { password: 'new-secure-password' } },
    res,
    jest.fn(),
  );
  expect(Session.revoke).toHaveBeenCalledWith('session-1');
  expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Password reset and active sessions revoked' });
});

test('another OA cannot edit or void a credit or recalculate its balance', async () => {
  const req = { user: { _id: 'oa-2', role: 'oa' }, params: { id: 'credit-1' }, body: { notes: 'Changed' } };
  for (const handler of [updateOwnIssuedCredit, voidOwnIssuedCredit]) {
    const res = response();
    const next = jest.fn();
    await handler(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  }
  expect(Credit.updateOwned).not.toHaveBeenCalled();
  expect(recalcFacultyCredits).not.toHaveBeenCalled();
});

test('issuing OA voids a credit while retaining its record and audit event', async () => {
  const req = { user: { _id: 'oa-1', role: 'oa' }, params: { id: 'credit-1' }, body: { reason: 'Entered in error' } };
  const res = response();
  await voidOwnIssuedCredit(req, res, jest.fn());
  expect(Credit.updateOwned).toHaveBeenCalledWith(
    'credit-1',
    'oa-1',
    expect.objectContaining({ status: 'deleted', deletedBy: 'oa-1' }),
    expect.objectContaining({ action: 'voided', reason: 'Entered in error' }),
    baseCredit.updatedAt,
  );
  expect(recalcFacultyCredits).toHaveBeenCalledWith('faculty-1');
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});

test('issuing OA can change a category but cannot set arbitrary points', async () => {
  CreditTitle.findById.mockResolvedValue({
    _id: 'title-2',
    title: 'New violation',
    type: 'negative',
    points: 7,
    isActive: true,
  });
  const req = {
    user: { _id: 'oa-1', role: 'oa' },
    params: { id: 'credit-1' },
    body: { creditTitleId: 'title-2', notes: 'Corrected category' },
  };
  const res = response();
  await updateOwnIssuedCredit(req, res, jest.fn());
  expect(Credit.updateOwned).toHaveBeenCalledWith(
    'credit-1',
    'oa-1',
    expect.objectContaining({ creditTitle: 'title-2', title: 'New violation', points: -7 }),
    expect.objectContaining({ action: 'edited' }),
    baseCredit.updatedAt,
  );
  expect(recalcFacultyCredits).toHaveBeenCalledWith('faculty-1');
  Credit.updateOwned.mockClear();
  await updateOwnIssuedCredit({ ...req, body: { points: -100 } }, response(), jest.fn());
  expect(Credit.updateOwned).not.toHaveBeenCalled();
});

test('manual positive point correction requires a reason and records the old and new amount', async () => {
  Credit.findById.mockResolvedValue({ ...baseCredit, type: 'positive', status: 'approved', points: 5 });
  const req = {
    user: { _id: 'oa-1', role: 'oa' },
    params: { id: 'credit-1' },
    body: { points: '8', reason: 'Approved correction' },
  };
  await updateOwnIssuedCredit(req, response(), jest.fn());
  expect(Credit.updateOwned).toHaveBeenCalledWith(
    'credit-1',
    'oa-1',
    expect.objectContaining({ points: 8 }),
    expect.objectContaining({
      reason: 'Approved correction',
      before: expect.objectContaining({ points: 5 }),
      after: expect.objectContaining({ points: 8 }),
    }),
    baseCredit.updatedAt,
  );
  Credit.updateOwned.mockClear();
  await updateOwnIssuedCredit({ ...req, body: { points: '8' } }, response(), jest.fn());
  expect(Credit.updateOwned).not.toHaveBeenCalled();
});

test('voiding requires a recorded reason', async () => {
  const res = response();
  await voidOwnIssuedCredit(
    { user: { _id: 'oa-1', role: 'oa' }, params: { id: 'credit-1' }, body: {} },
    res,
    jest.fn(),
  );
  expect(res.status).toHaveBeenCalledWith(400);
  expect(Credit.updateOwned).not.toHaveBeenCalled();
});

test('OA cannot void a credit while the faculty appeal is pending', async () => {
  Credit.findById.mockResolvedValue({ ...baseCredit, appeal: { status: 'pending' } });
  const res = response();
  await voidOwnIssuedCredit(
    { user: { _id: 'oa-1', role: 'oa' }, params: { id: 'credit-1' }, body: { reason: 'Entered in error' } },
    res,
    jest.fn(),
  );
  expect(res.status).toHaveBeenCalledWith(409);
  expect(Credit.updateOwned).not.toHaveBeenCalled();
});

jest.mock('../../Models/Credit', () => ({ create: jest.fn(), findById: jest.fn(), voidByActor: jest.fn() }));
jest.mock('../../Models/CreditTitle', () => ({ findById: jest.fn() }));
jest.mock('../../Models/User', () => ({ findById: jest.fn() }));
jest.mock('../../config/db', () => ({ connectDB: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/calculateCredits', () => ({ recalcFacultyCredits: jest.fn().mockResolvedValue({}) }));
jest.mock('../../utils/fileUpload', () => ({ handleFileUpload: jest.fn() }));
jest.mock('../../Controllers/pushController', () => ({ sendPushToUser: jest.fn() }));

const Credit = require('../../Models/Credit');
const CreditTitle = require('../../Models/CreditTitle');
const User = require('../../Models/User');
const { issueNegativeCredit, issuePositiveCredit, voidPositiveCredit } = require('../../Controllers/Admin/CreditManageController');

const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const request = body => ({ user: { _id: 'oa-1', role: 'oa' }, body,
  app: { locals: { io: { emit: jest.fn() } } } });

beforeEach(() => {
  jest.clearAllMocks();
  User.findById.mockResolvedValue({ _id: 'faculty-1', role: 'faculty', isActive: true, name: 'Asha' });
  Credit.create.mockImplementation(async data => ({ _id: 'credit-1', ...data }));
});

test('negative issuance uses the template amount and issuing OA identity', async () => {
  CreditTitle.findById.mockResolvedValue({ _id: 'title-1', type: 'negative', isActive: true, points: 5, title: 'Violation' });
  const res = response();
  await issueNegativeCredit(request({ facultyId: 'faculty-1', creditTitleId: 'title-1',
    academicYear: '2026-27', points: -999, title: 'Spoofed' }), res, jest.fn());
  expect(Credit.create).toHaveBeenCalledWith(expect.objectContaining({ faculty: 'faculty-1', issuedBy: 'oa-1',
    type: 'negative', points: -5, title: 'Violation' }));
  expect(res.status).toHaveBeenCalledWith(201);
});

test('positive template overrides client points and manual awards reject negative values', async () => {
  CreditTitle.findById.mockResolvedValue({ _id: 'title-2', type: 'positive', isActive: true, points: 8, title: 'Achievement' });
  const res = response();
  await issuePositiveCredit(request({ facultyId: 'faculty-1', creditTitleId: 'title-2',
    academicYear: '2026-27', points: '999', title: 'Spoofed' }), res, jest.fn());
  expect(Credit.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'positive', points: 8,
    title: 'Achievement', issuedBy: 'oa-1' }));
  Credit.create.mockClear();
  const invalid = response();
  await issuePositiveCredit(request({ facultyId: 'faculty-1', academicYear: '2026-27', points: '-2',
    title: 'Manual award' }), invalid, jest.fn());
  expect(invalid.status).toHaveBeenCalledWith(400);
  expect(Credit.create).not.toHaveBeenCalled();
});

test('admin void preserves the positive credit and recalculates its faculty balance', async () => {
  Credit.findById.mockResolvedValue({ _id: 'credit-1', faculty: 'faculty-1', type: 'positive',
    status: 'approved', points: 8, updatedAt: '2026-09-28T00:00:00.000Z' });
  Credit.voidByActor.mockResolvedValue({ _id: 'credit-1', status: 'deleted' });
  const res = response();
  await voidPositiveCredit({ ...request({ reason: 'Issued in error' }), params: { id: 'credit-1' } }, res, jest.fn());
  expect(Credit.voidByActor).toHaveBeenCalledWith('credit-1', 'oa-1', '2026-09-28T00:00:00.000Z',
    expect.objectContaining({ reason: 'Issued in error' }));
  expect(require('../../utils/calculateCredits').recalcFacultyCredits).toHaveBeenCalledWith('faculty-1');
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, balanceUpdated: true }));
});

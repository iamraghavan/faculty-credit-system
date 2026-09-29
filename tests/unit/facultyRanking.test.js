jest.mock('../../Models/User', () => ({ find: jest.fn() }));
jest.mock('../../Models/Credit', () => ({ find: jest.fn() }));

const User = require('../../Models/User');
const Credit = require('../../Models/Credit');
const { getFacultyRanking } = require('../../Controllers/facultyLedgerController');

const faculty = [
  { _id: 'a', role: 'faculty', name: 'Asha', college: 'Arts', department: 'Physics' },
  { _id: 'b', role: 'faculty', name: 'Bina', college: 'Arts', department: 'Physics' },
  { _id: 'c', role: 'faculty', name: 'Chitra', college: 'Science', department: 'Physics' },
];
const credits = [
  { faculty: 'a', type: 'positive', status: 'approved', points: 8, createdAt: '2026-09-01' },
  { faculty: 'b', type: 'positive', status: 'approved', points: 3, createdAt: '2026-09-01' },
  { faculty: 'c', type: 'positive', status: 'approved', points: 5, createdAt: '2026-09-01' },
];

async function ranking(groupBy, type = 'all', sort = 'desc') {
  const res = { json: jest.fn() };
  const next = jest.fn();
  await getFacultyRanking({ query: { groupBy, type, sort } }, res, next);
  expect(next).not.toHaveBeenCalled();
  return res.json.mock.calls[0][0].data.rows;
}

beforeEach(() => {
  User.find.mockResolvedValue(faculty);
  Credit.find.mockResolvedValue(credits);
});

test('department view restarts ranks for the same department in another college', async () => {
  const rows = await ranking('department');
  expect(rows.map(row => [row.faculty.name, row.rankingGroup, row.rank])).toEqual([
    ['Asha', 'Arts / Physics', 1],
    ['Bina', 'Arts / Physics', 2],
    ['Chitra', 'Science / Physics', 1],
  ]);
});

test('college view ranks faculty within each college while institution view ranks everyone together', async () => {
  const collegeRows = await ranking('college');
  expect(collegeRows.map(row => [row.faculty.name, row.rankingGroup, row.rank])).toEqual([
    ['Asha', 'Arts', 1],
    ['Bina', 'Arts', 2],
    ['Chitra', 'Science', 1],
  ]);

  const institutionRows = await ranking('institution');
  expect(institutionRows.map(row => [row.faculty.name, row.rank])).toEqual([
    ['Asha', 1],
    ['Chitra', 2],
    ['Bina', 3],
  ]);
});

test('positive ranking uses approved positive points and ignores pending submissions', async () => {
  Credit.find.mockResolvedValue([
    ...credits,
    { faculty: 'b', type: 'positive', status: 'pending', points: 100, createdAt: '2026-09-02' },
    { faculty: 'a', type: 'negative', status: 'pending', points: 20, createdAt: '2026-09-02' },
  ]);
  const rows = await ranking('college', 'positive');
  expect(rows.map(row => [row.faculty.name, row.rank, row.rankingPoints])).toEqual([
    ['Asha', 1, 8],
    ['Bina', 2, 3],
    ['Chitra', 1, 5],
  ]);
});

test('negative ranking shows the largest active deductions first within a college', async () => {
  Credit.find.mockResolvedValue([
    { faculty: 'a', type: 'negative', status: 'pending', points: 4, createdAt: '2026-09-02' },
    { faculty: 'b', type: 'negative', status: 'appealed', points: 9, appeal: { status: 'pending' }, createdAt: '2026-09-02' },
    { faculty: 'c', type: 'negative', status: 'rejected', points: 20, appeal: { status: 'accepted' }, createdAt: '2026-09-02' },
  ]);
  const rows = await ranking('college', 'negative');
  expect(rows.map(row => [row.faculty.name, row.rank, row.rankingPoints])).toEqual([
    ['Bina', 1, 9],
    ['Asha', 2, 4],
    ['Chitra', null, 0],
  ]);
  expect(rows[0].statusCounts).toEqual({ appealed: 1 });
  expect(rows[0].appealStatusCounts).toEqual({ pending: 1 });
  expect(rows[2].appealStatusCounts).toEqual({ accepted: 1 });
  const ascending = await ranking('college', 'negative', 'asc');
  expect(ascending.map(row => [row.faculty.name, row.rank, row.rankingPoints])).toEqual([
    ['Asha', 1, 4],
    ['Bina', 2, 9],
    ['Chitra', null, 0],
  ]);
});

test('faculty without effective credits are unranked after scored faculty in either sort order', async () => {
  User.find.mockResolvedValue([...faculty, { _id: 'd', role: 'faculty', name: 'Vigneshwaran', college: 'Arts', department: 'Physics' }]);
  for (const sort of ['asc', 'desc']) {
    const rows = await ranking('college', 'all', sort);
    const arts = rows.filter(row => row.rankingGroup === 'Arts');
    expect(arts.at(-1)).toMatchObject({ faculty: { name: 'Vigneshwaran' }, rank: null, rankingPoints: 0, records: 0 });
    expect(arts.slice(0, -1).map(row => row.rank)).toEqual([1, 2]);
  }
});

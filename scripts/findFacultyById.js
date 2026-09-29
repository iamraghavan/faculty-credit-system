require('dotenv').config();
const { connectDB } = require('../config/db');
const User = require('../Models/User');
const Credit = require('../Models/Credit');
const { processCredits } = require('../utils/calculateCredits');
const { getFacultyRanking } = require('../Controllers/facultyLedgerController');

async function main() {
  const facultyID = process.argv[2];
  if (!facultyID) throw new Error('Usage: node scripts/findFacultyById.js FACULTY_ID');
  await connectDB();
  const users = await User.find({ facultyID });
  const includeCredits = process.argv.includes('--credits');
  const result = await Promise.all(users.map(async ({ _id, prefix, name, facultyID: id, college, department, role, isActive,
    totalPositiveCredit, totalNegativeCredit, currentCredit }) => {
    const account = { _id, prefix, name, facultyID: id, college, department, role, isActive };
    if (!includeCredits) return account;
    const credits = await Credit.find({ faculty: String(_id) });
    const byTypeAndStatus = {};
    for (const credit of credits) {
      const key = `${credit.type || 'unknown'}:${credit.status || 'unknown'}`;
      byTypeAndStatus[key] = (byTypeAndStatus[key] || 0) + 1;
    }
    let ranking;
    if (process.argv.includes('--ranking')) {
      const response = { json: body => { ranking = body.data?.rows.find(row => row.faculty.id === _id); } };
      await getFacultyRanking({ query: {} }, response, error => { throw error; });
    }
    return { ...account, cached: { totalPositiveCredit, totalNegativeCredit, currentCredit },
      source: processCredits(credits), recordCount: credits.length, byTypeAndStatus,
      ...(ranking ? { ranking: { rank: ranking.rank, positivePoints: ranking.positivePoints,
        negativePoints: ranking.negativePoints, netCredits: ranking.netCredits, records: ranking.records } } : {}) };
  }));
  console.log(JSON.stringify(result));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

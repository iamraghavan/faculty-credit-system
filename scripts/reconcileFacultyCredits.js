'use strict';

require('dotenv').config({ quiet: true });
const { connectDB } = require('../config/db');
const Credit = require('../Models/Credit');
const User = require('../Models/User');
const { processCredits, updateUserCredits } = require('../utils/calculateCredits');

const apply = process.argv.includes('--apply');
if (apply && !process.argv.includes('--confirm-policy=issued-negative-immediate')) {
  throw new Error('Applying requires --confirm-policy=issued-negative-immediate');
}

function differs(user, metrics) {
  const close = (a, b) => Number.isFinite(Number(a)) && Math.abs(Number(a) - b) < 1e-9;
  const sameMap = (actual, expected) => {
    if (!actual || typeof actual !== 'object') return false;
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    return [...keys].every(key => close(actual[key] ?? 0, expected[key] ?? 0));
  };
  return !close(user.currentCredit ?? 0, metrics.runningTotal) ||
    !close(user.totalPositiveCredit, metrics.totalPositive) ||
    !close(user.totalNegativeCredit, metrics.totalNegative) ||
    !sameMap(user.creditsByYear, metrics.netByYear) ||
    !sameMap(user.positiveCreditsByYear, metrics.positiveByYear) ||
    !sameMap(user.negativeCreditsByYear, metrics.negativeByYear);
}

async function main() {
  await connectDB();
  const [users, credits] = await Promise.all([User.find(), Credit.find()]);
  const byFaculty = new Map();
  for (const credit of credits) {
    const id = String(credit.faculty || '');
    if (!id) continue;
    if (!byFaculty.has(id)) byFaculty.set(id, []);
    byFaculty.get(id).push(credit);
  }

  const faculty = users.filter(user => String(user.role || '').toLowerCase() === 'faculty');
  const stats = { mode: apply ? 'apply' : 'dry-run', faculty: faculty.length, credits: credits.length, changedFaculty: 0, updatedFaculty: 0, failedFaculty: 0, oldNet: 0, newNet: 0, totalPositive: 0, totalNegative: 0 };
  for (const user of faculty) {
    const metrics = processCredits(byFaculty.get(String(user._id)) || []);
    stats.oldNet += Number(user.currentCredit) || 0;
    stats.newNet += metrics.runningTotal;
    stats.totalPositive += metrics.totalPositive;
    stats.totalNegative += metrics.totalNegative;
    if (!differs(user, metrics)) continue;
    stats.changedFaculty++;
    if (apply) {
      try {
        await updateUserCredits(user, metrics);
        stats.updatedFaculty++;
      } catch (error) {
        stats.failedFaculty++;
        console.error(`Balance update failed for faculty ${user._id}: ${error.message}`);
      }
    }
  }
  stats.oldNet = Number(stats.oldNet.toFixed(4));
  stats.newNet = Number(stats.newNet.toFixed(4));
  stats.totalPositive = Number(stats.totalPositive.toFixed(4));
  stats.totalNegative = Number(stats.totalNegative.toFixed(4));
  console.log(JSON.stringify(stats));
  if (stats.failedFaculty) process.exitCode = 1;
}

main().catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 1; });

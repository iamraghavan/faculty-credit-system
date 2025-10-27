// utils/calculateCredits.js
const Credit = require('../Models/Credit');
const User = require('../Models/User');

/**
 * Recalculate faculty credits
 * - Applies credits in chronological order (createdAt ascending) so ledger-style behavior is explicit.
 * - Rules:
 *   - Positive credit: count only if status === 'approved'
 *   - Negative credit:
 *       - If no appeal: include (deduct) when status === 'approved' or 'rejected'
 *       - If appeal exists: include (deduct) only when appeal.status === 'rejected'
 *       - If appeal.status === 'pending' or 'accepted' -> skip (do not deduct)
 *
 * Updates:
 * - user.currentCredit -> overall net (sum of positives minus negatives, applied in chronological order)
 * - user.creditsByYear -> a Map/object of net points by academicYear
 *
 * Returns detailed breakdown:
 * {
 *   currentCredit: Number,
 *   creditsByYear: { "<year>": netNumber, ... },
 *   positiveByYear: { "<year>": positiveSum, ... },
 *   negativeByYear: { "<year>": negativeSum, ... },
 *   totalPositive: Number,
 *   totalNegative: Number,
 *   eventsApplied: Number
 * }
 */
async function recalcFacultyCredits(facultyId) {
  if (!facultyId) throw new Error('Faculty ID is required');

  const user = await User.findById(facultyId);
  if (!user) throw new Error('User not found');

  // Fetch all credits for the faculty and sort by createdAt so we apply them in order.
  // Using lean() for speed.
  const credits = await Credit.find({ faculty: facultyId }).sort({ createdAt: 1 }).lean();

  // breakdown containers
  const positiveByYear = {};
  const negativeByYear = {};
  const netByYear = {};

  let runningTotal = 0;
  let totalPositive = 0;
  let totalNegative = 0;
  let eventsApplied = 0;

  for (const credit of credits) {
    const year = credit.academicYear || 'unknown';

    // Ensure keys exist
    if (!positiveByYear[year]) positiveByYear[year] = 0;
    if (!negativeByYear[year]) negativeByYear[year] = 0;
    if (!netByYear[year]) netByYear[year] = 0;

    if (credit.type === 'positive') {
      // Only approved positive credits count
      if (credit.status === 'approved') {
        const pts = Number(credit.points) || 0;
        positiveByYear[year] += pts;
        netByYear[year] += pts;
        runningTotal += pts;
        totalPositive += pts;
        eventsApplied += 1;
      } else {
        // not approved -> ignore
      }
    } else if (credit.type === 'negative') {
      let applyNegative = false;

      if (credit.appeal) {
        // Negative credit with appeal: deduct only if appeal rejected
        if (credit.appeal.status === 'rejected') applyNegative = true;
      } else {
        // Negative credit without appeal: deduct if status is approved or rejected
        if (credit.status === 'approved' || credit.status === 'rejected') applyNegative = true;
      }

      if (applyNegative) {
        // Deduct absolute value (points may already be negative or positive)
        const deduction = Math.abs(Number(credit.points) || 0);
        negativeByYear[year] += deduction;
        netByYear[year] -= deduction;
        runningTotal -= deduction;
        totalNegative += deduction;
        eventsApplied += 1;
      } else {
        // appeal pending/accepted -> skip deducting
      }
    }
  }

  // Convert netByYear to a plain object (if using Map on schema you can set accordingly)
  // Update user document
  user.currentCredit = runningTotal;
  user.creditsByYear = netByYear;

  await user.save();

  return {
    currentCredit: runningTotal,
    creditsByYear: netByYear,
    positiveByYear,
    negativeByYear,
    totalPositive,
    totalNegative,
    netTotal: runningTotal,
    eventsApplied,
  };
}

module.exports = { recalcFacultyCredits };

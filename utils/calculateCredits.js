// utils/calculateCredits.js
const Credit = require('../Models/Credit');
const User = require('../Models/User');

/**
 * Recalculate faculty credits
 * - Applies credits in chronological order (createdAt ascending) so ledger-style behavior is explicit.
 * - Rules (updated for negative-credit handling):
 *   - Positive credit: count only if status === 'approved'
 *   - Negative credit:
 *       - If NO appeal: include (deduct) only when status === 'approved'
 *       - If appeal exists:
 *           - appeal.status === 'rejected' -> include (deduct)
 *           - appeal.status === 'accepted' -> do NOT include
 *           - appeal.status is null/undefined/''/'none' (case-insensitive) -> do NOT include
 *           - any other appeal.status (e.g., 'pending') -> do NOT include
 *
 * Updates:
 * - user.currentCredit -> overall net (sum of positives minus negatives, applied in chronological order)
 * - user.creditsByYear -> a Map/object of net points by academicYear
 *
 * Returns detailed breakdown.
 */
async function recalcFacultyCredits(facultyId) {
  if (!facultyId) throw new Error('Faculty ID is required');

  const user = await User.findById(facultyId);
  if (!user) throw new Error('User not found');

  // Fetch all credits for the faculty and sort by createdAt so we apply them in order.
  const credits = await Credit.find({ faculty: facultyId }).sort({ createdAt: 1 }).lean();

  const positiveByYear = {};
  const negativeByYear = {};
  const netByYear = {};

  let runningTotal = 0;
  let totalPositive = 0;
  let totalNegative = 0;
  let eventsApplied = 0;

  for (const credit of credits) {
    const year = credit.academicYear || 'unknown';

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
      }
      // otherwise ignore
      continue;
    }

    if (credit.type === 'negative') {
      let applyNegative = false;

      const appeal = credit.appeal;

      if (appeal) {
        // normalize appeal.status
        const rawStatus = (appeal.status === undefined || appeal.status === null) ? '' : String(appeal.status).trim().toLowerCase();

        // treat empty-like statuses as "do not include"
        const isEmptyLike = rawStatus === '' || rawStatus === 'none' || rawStatus === 'null' || rawStatus === 'nil';

        if (rawStatus === 'rejected') {
          applyNegative = true;
        } else {
          // appeal.status is 'accepted', 'pending', empty-like, or anything else -> do not apply
          applyNegative = false;
        }

        // Note: per requirements, empty-like appeal.status should be disregarded (not applied).
        if (isEmptyLike) applyNegative = false;
      } else {
        // No appeal object: include only if credit.status === 'approved'
        if (credit.status === 'approved') applyNegative = true;
      }

      if (applyNegative) {
        const deduction = Math.abs(Number(credit.points) || 0);
        negativeByYear[year] += deduction;
        netByYear[year] -= deduction;
        runningTotal -= deduction;
        totalNegative += deduction;
        eventsApplied += 1;
      }
      // else skip deduction
    }
  }

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

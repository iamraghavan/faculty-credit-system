// utils/calculateCredits.js
const Credit = require('../Models/Credit');
const User = require('../Models/User');

/**
 * Detect if the current models are DynamoDB-based or MongoDB-based.
 * We'll check whether .findById returns a promise that resolves to a plain object (Dynamo)
 * or a Mongoose document (has .save method).
 */
function isDynamoUserModel(user) {
  return user && typeof user.save !== 'function'; // Dynamo returns plain objects, Mongo has .save()
}

/**
 * Recalculate faculty credits
 * Works with both MongoDB and DynamoDB models.
 */
async function recalcFacultyCredits(facultyId) {
  if (!facultyId) throw new Error('Faculty ID is required');

  // --- Fetch user ---
  let user = await User.findById(facultyId);
  if (!user) throw new Error('User not found');

  // --- Fetch all credits ---
  let credits = await Credit.find({ faculty: facultyId });
  // Sort chronologically by createdAt
  credits.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

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

    // Positive credits
    if (credit.type === 'positive') {
      if (credit.status === 'approved') {
        const pts = Number(credit.points) || 0;
        positiveByYear[year] += pts;
        netByYear[year] += pts;
        runningTotal += pts;
        totalPositive += pts;
        eventsApplied++;
      }
      continue;
    }

    // Negative credits
    if (credit.type === 'negative') {
      let applyNegative = false;
      const appeal = credit.appeal;

      if (appeal) {
        const rawStatus = (appeal.status ?? '').toString().trim().toLowerCase();
        const isEmptyLike = ['none', 'null', 'nil', ''].includes(rawStatus);

        if (rawStatus === 'rejected') {
          applyNegative = true;
        } else if (isEmptyLike || rawStatus === 'accepted' || rawStatus === 'pending') {
          applyNegative = false;
        }
      } else {
        if (credit.status === 'approved') applyNegative = true;
      }

      if (applyNegative) {
        const deduction = Math.abs(Number(credit.points) || 0);
        negativeByYear[year] += deduction;
        netByYear[year] -= deduction;
        runningTotal -= deduction;
        totalNegative += deduction;
        eventsApplied++;
      }
    }
  }

  user.currentCredit = runningTotal;
  user.creditsByYear = netByYear;

  // --- Save or Update user ---
  if (isDynamoUserModel(user)) {
    // DynamoDB path
    await User.update(user._id, {
      currentCredit: runningTotal,
      creditsByYear: netByYear,
      updatedAt: new Date().toISOString(),
    });
  } else {
    // MongoDB path
    await user.save();
  }

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

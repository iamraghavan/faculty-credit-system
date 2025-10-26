// utils/calculateCredits.js
const Credit = require('../Models/Credit');
const User = require('../Models/User');

/**
 * Calculate faculty credits based on all approved credits and appeal rules
 * Updates User.currentCredit and User.creditsByYear
 * 
 * Rules:
 * - Positive credit: only include if status === 'approved'
 * - Negative credit: include if status === 'approved'
 *      - If negative credit has appeal:
 *          - appeal.status === 'pending' -> don't include
 *          - appeal.status === 'accepted' -> don't include (appeal accepted -> ignore negative points)
 *          - appeal.status === 'rejected' -> include negative points
 */
async function recalcFacultyCredits(facultyId) {
  if (!facultyId) throw new Error('Faculty ID is required');

  const user = await User.findById(facultyId);
  if (!user) throw new Error('User not found');

  const credits = await Credit.find({ faculty: facultyId }).lean();

  const creditsByYear = {};

  let total = 0;

  for (const credit of credits) {
    const year = credit.academicYear || 'unknown';

    if (!creditsByYear[year]) creditsByYear[year] = 0;

    if (credit.type === 'positive') {
      if (credit.status === 'approved') {
        creditsByYear[year] += credit.points;
        total += credit.points;
      }
    } else if (credit.type === 'negative') {
      // Check appeal rules
      let applyNegative = true;

      if (credit.appeal) {
        if (credit.appeal.status === 'pending') applyNegative = false;
        if (credit.appeal.status === 'accepted') applyNegative = false;
        if (credit.appeal.status === 'rejected') applyNegative = true;
      } else if (credit.status !== 'approved') {
        applyNegative = false;
      }

      if (applyNegative) {
        creditsByYear[year] -= Math.abs(credit.points);
        total -= Math.abs(credit.points);
      }
    }
  }

  user.currentCredit = total;
  user.creditsByYear = creditsByYear;

  await user.save();
  return { currentCredit: total, creditsByYear };
}

module.exports = { recalcFacultyCredits };

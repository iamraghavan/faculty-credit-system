// utils/calculateCredits.js
const Credit = require('../Models/Credit');
const User = require('../Models/User');

/**
 * Recalculate faculty credits
 * Updates User.currentCredit and User.creditsByYear
 * 
 * Rules:
 * - Positive credit: only include if status === 'approved'
 * - Negative credit: include if status === 'approved'
 *      - If negative credit has appeal:
 *          - appeal.status === 'pending' -> skip
 *          - appeal.status === 'accepted' -> skip
 *          - appeal.status === 'rejected' -> deduct
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
      // Only approved positive credits count
      if (credit.status === 'approved') {
        creditsByYear[year] += credit.points;
        total += credit.points;
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
        const deduction = Math.abs(credit.points);
        creditsByYear[year] -= deduction;
        total -= deduction;
      }
    }
  }

  // Update user document
  user.currentCredit = total;
  user.creditsByYear = creditsByYear;

  await user.save();
  return { currentCredit: total, creditsByYear };
}

module.exports = { recalcFacultyCredits };



/*

Positive credits → include only if status is approved
Negative credits → include only if applicable based on appeal rules:
No appeal: include if status is approved or rejected (deduct points)
Appeal exists: include only if appeal.status is rejected
Do not include if appeal.status is pending or accepted

*/
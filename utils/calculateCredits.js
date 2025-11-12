// utils/calculateCredits.js
'use strict';

const Credit = require('../Models/Credit');
const User = require('../Models/User');

const EXCLUDE_STATUS = new Set(['pending', 'deleted']);

/**
 * Determine if this user object is from DynamoDB (plain object, no `.save()`).
 * @param {Object} user
 * @returns {boolean}
 */
function isDynamoUserModel(user) {
  return user && typeof user.save !== 'function';
}

/**
 * Fetch the user by ID and validate existence.
 * @param {string} facultyId
 * @returns {Promise<Object>} user object
 * @throws {Error}
 */
async function fetchUser(facultyId) {
  if (!facultyId) {
    const err = new Error('Faculty ID parameter is required.');
    err.code = 'MISSING_FACULTY_ID';
    throw err;
  }
  const user = await User.findById(facultyId);
  if (!user) {
    const err = new Error(`User not found for id=${facultyId}`);
    err.code = 'USER_NOT_FOUND';
    throw err;
  }
  return user;
}

/**
 * Fetch all credits for a faculty and sort them chronologically.
 * Filters out credits whose status or appeal.status are excluded (pending/deleted).
 * @param {string} facultyId
 * @returns {Promise<Array>} sorted credits (filtered)
 */
async function fetchAndSortCredits(facultyId) {
  const credits = await Credit.find({ faculty: facultyId });
  if (!Array.isArray(credits)) {
    const err = new Error(`Unexpected result fetching credits for facultyId=${facultyId}`);
    err.code = 'CREDITS_FETCH_ERROR';
    throw err;
  }

  // Filter out credits with excluded status early to reduce further work
  const filtered = credits.filter((c) => {
    const status = (c && c.status) ? String(c.status).trim().toLowerCase() : '';
    if (EXCLUDE_STATUS.has(status)) return false;

    const appealStatus = (c && c.appeal && c.appeal.status) ? String(c.appeal.status).trim().toLowerCase() : '';
    if (appealStatus && EXCLUDE_STATUS.has(appealStatus)) return false;

    return true;
  });

  filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return filtered;
}

/**
 * Process credits array to compute positive, negative, net by year, and overall totals.
 * Expects input credits already filtered to exclude pending/deleted statuses (by fetchAndSortCredits),
 * but defends anyway.
 * @param {Array} credits
 * @returns {Object} result object with metrics
 */
function processCredits(credits) {
  const positiveByYear = Object.create(null);   // points
  const negativeByYear = Object.create(null);   // points (positive numbers for deductions)
  const netByYear = Object.create(null);        // net points (positive - negative)
  const positiveCountByYear = Object.create(null);
  const negativeCountByYear = Object.create(null);

  let runningTotal = 0;
  let totalPositive = 0;       // sum of positive points (approved)
  let totalNegative = 0;       // sum of negative points actually applied
  let eventsApplied = 0;

  for (let i = 0; i < credits.length; i++) {
    const credit = credits[i];
    if (!credit) continue;

    // Defensive status checks (skip if excluded)
    const status = (credit.status || '').toString().trim().toLowerCase();
    if (EXCLUDE_STATUS.has(status)) continue;
    const appealStatusRaw = (credit.appeal && credit.appeal.status) ? String(credit.appeal.status).trim().toLowerCase() : '';
    if (appealStatusRaw && EXCLUDE_STATUS.has(appealStatusRaw)) continue;

    const year = credit.academicYear || 'unknown';

    if (!positiveByYear[year]) positiveByYear[year] = 0;
    if (!negativeByYear[year]) negativeByYear[year] = 0;
    if (!netByYear[year]) netByYear[year] = 0;
    if (!positiveCountByYear[year]) positiveCountByYear[year] = 0;
    if (!negativeCountByYear[year]) negativeCountByYear[year] = 0;

    // Defensive points coercion
    const pts = Number(credit.points ?? 0) || 0;

    if (String(credit.type) === 'positive') {
      // Only count approved positives
      if (String(credit.status).toLowerCase() === 'approved') {
        positiveByYear[year] += pts;
        positiveCountByYear[year] += 1;
        netByYear[year] += pts;
        runningTotal += pts;
        totalPositive += pts;
        eventsApplied++;
      }
      // else: pending/other statuses are ignored (we filtered pending/deleted earlier)
    } else if (String(credit.type) === 'negative') {
      // Negative applies either when appeal.status === 'rejected' OR
      // when there is no appeal and credit.status === 'approved'
      let applyNegative = false;
      if (appealStatusRaw) {
        if (appealStatusRaw === 'rejected') applyNegative = true;
        else applyNegative = false;
      } else {
        if (String(credit.status).toLowerCase() === 'approved') applyNegative = true;
      }

      if (applyNegative) {
        const deduction = Math.abs(pts);
        negativeByYear[year] += deduction;
        negativeCountByYear[year] += 1;
        netByYear[year] -= deduction;
        runningTotal -= deduction;
        totalNegative += deduction;
        eventsApplied++;
      }
    } else {
      // Unknown type — ignore for positive/negative sums but still keep net/year presence
    }
  }

  return {
    runningTotal,
    totalPositive,
    totalNegative,
    eventsApplied,
    positiveByYear,
    negativeByYear,
    netByYear,
    positiveCountByYear,
    negativeCountByYear,
  };
}

/**
 * Persist the recalculated credits back to the user record.
 * @param {Object} user
 * @param {Object} metrics
 * @returns {Promise<void>}
 */
async function updateUserCredits(user, metrics) {
  const updatePayload = {
    currentCredit: metrics.runningTotal,
    creditsByYear: metrics.netByYear,
    updatedAt: new Date().toISOString(),
  };

  if (isDynamoUserModel(user)) {
    await User.update(user._id, updatePayload);
  } else {
    // MongoDB path
    user.currentCredit = metrics.runningTotal;
    user.creditsByYear = metrics.netByYear;
    user.updatedAt = updatePayload.updatedAt;
    await user.save();
  }
}

/**
 * Recalculate faculty credits for a given faculty user ID.
 * Excludes credits whose status or appeal.status are 'pending' or 'deleted'.
 * @param {string} facultyId
 * @returns {Promise<Object>} result metrics
 * @throws {Error} with helpful code/message
 */
async function recalcFacultyCredits(facultyId) {
  try {
    const user = await fetchUser(facultyId);
    const credits = await fetchAndSortCredits(facultyId); // already filters pending/deleted
    const metrics = processCredits(credits);
    await updateUserCredits(user, metrics);

    return {
      currentCredit: metrics.runningTotal,
      creditsByYear: metrics.netByYear,
      positiveByYear: metrics.positiveByYear,
      negativeByYear: metrics.negativeByYear,
      positiveCountByYear: metrics.positiveCountByYear,
      negativeCountByYear: metrics.negativeCountByYear,
      totalPositive: metrics.totalPositive,
      totalNegative: metrics.totalNegative,
      netTotal: metrics.runningTotal,
      eventsApplied: metrics.eventsApplied,
    };
  } catch (err) {
    const error = new Error(`recalcFacultyCredits failed: ${err.message}`);
    error.original = err;
    throw error;
  }
}

module.exports = {
  recalcFacultyCredits,
  // Export internal functions for testing if desired
  fetchUser,
  fetchAndSortCredits,
  processCredits,
  updateUserCredits,
};

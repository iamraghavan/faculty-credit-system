// utils/calculateCredits.js
'use strict';

const Credit = require('../Models/Credit');
const User = require('../Models/User');

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
    throw new Error('Faculty ID parameter is required.');
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
 * @param {string} facultyId
 * @returns {Promise<Array>} sorted credits
 */
async function fetchAndSortCredits(facultyId) {
  const credits = await Credit.find({ faculty: facultyId });
  if (!Array.isArray(credits)) {
    const err = new Error(`Unexpected result fetching credits for facultyId=${facultyId}`);
    err.code = 'CREDITS_FETCH_ERROR';
    throw err;
  }
  credits.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return credits;
}

/**
 * Process credits array to compute positive, negative, net by year, and overall totals.
 * @param {Array} credits
 * @returns {Object} result object with metrics
 */
function processCredits(credits) {
  const positiveByYear = {};
  const negativeByYear = {};
  const netByYear = {};

  let runningTotal = 0;
  let totalPositive = 0;
  let totalNegative = 0;
  let eventsApplied = 0;

  for (const credit of credits) {
    const year = credit.academicYear || 'unknown';

    if (!(year in positiveByYear)) positiveByYear[year] = 0;
    if (!(year in negativeByYear)) negativeByYear[year] = 0;
    if (!(year in netByYear)) netByYear[year] = 0;

    const pts = Number(credit.points) || 0;

    if (credit.type === 'positive' && credit.status === 'approved') {
      positiveByYear[year] += pts;
      netByYear[year] += pts;
      runningTotal += pts;
      totalPositive += pts;
      eventsApplied++;
    } else if (credit.type === 'negative') {
      let applyNegative = false;
      if (credit.appeal) {
        const rawStatus = String(credit.appeal.status || '').trim().toLowerCase();
        const isEmpty = ['', 'none', 'null', 'nil'].includes(rawStatus);
        if (rawStatus === 'rejected') {
          applyNegative = true;
        } else {
          applyNegative = false;
        }
      } else {
        if (credit.status === 'approved') {
          applyNegative = true;
        }
      }

      if (applyNegative) {
        const deduction = Math.abs(pts);
        negativeByYear[year] += deduction;
        netByYear[year] -= deduction;
        runningTotal -= deduction;
        totalNegative += deduction;
        eventsApplied++;
      }
    }
    // else: ignore other types/status combinations
  }

  return {
    runningTotal,
    totalPositive,
    totalNegative,
    eventsApplied,
    positiveByYear,
    negativeByYear,
    netByYear,
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
 * @param {string} facultyId
 * @returns {Promise<Object>} result metrics
 * @throws {Error} with helpful code/message
 */
async function recalcFacultyCredits(facultyId) {
  try {
    const user = await fetchUser(facultyId);
    const credits = await fetchAndSortCredits(facultyId);
    const metrics = processCredits(credits);
    await updateUserCredits(user, metrics);

    return {
      currentCredit: metrics.runningTotal,
      creditsByYear: metrics.netByYear,
      positiveByYear: metrics.positiveByYear,
      negativeByYear: metrics.negativeByYear,
      totalPositive: metrics.totalPositive,
      totalNegative: metrics.totalNegative,
      netTotal: metrics.runningTotal,
      eventsApplied: metrics.eventsApplied,
    };
  } catch (err) {
    // Enhance error with context
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

// utils/calculateCredits.js
'use strict';

const _ = require('lodash');
const { create, all } = require('mathjs');
const Credit = require('../Models/Credit');
const User = require('../Models/User');

// Configure mathjs for high precision decimal arithmetic if needed
const math = create(all, { precision: 16 });

const EXCLUDE_STATUS = ['pending', 'deleted'];

/**
 * Determine if this user object is from DynamoDB (plain object, no `.save()`).
 */
function isDynamoUserModel(user) {
  return user && typeof user.save !== 'function';
}

/**
 * Fetch the user by ID and validate existence.
 */
async function fetchUser(facultyId) {
  if (!facultyId) throw new Error('Faculty ID parameter is required.');
  const user = await User.findById(facultyId);
  if (!user) throw new Error(`User not found for id=${facultyId}`);
  return user;
}

/**
 * Fetch all credits for a faculty and sort them chronologically.
 */
async function fetchAndSortCredits(facultyId) {
  const credits = await Credit.find({ faculty: facultyId });
  if (!Array.isArray(credits)) throw new Error(`Credits fetch error for ${facultyId}`);

  // Use Lodash to filter and sort
  return _.chain(credits)
    .filter(c => {
      const status = _.get(c, 'status', '').toLowerCase();
      const appealStatus = _.get(c, 'appeal.status', '').toLowerCase();
      return !_.includes(EXCLUDE_STATUS, status) && !_.includes(EXCLUDE_STATUS, appealStatus);
    })
    .sortBy(c => new Date(c.createdAt))
    .value();
}

/**
 * Process credits array using functional patterns and precision math.
 */
function processCredits(credits) {
  // Initialize accumulators
  const stats = {
    runningTotal: math.bignumber(0),
    totalPositive: math.bignumber(0),
    totalNegative: math.bignumber(0),
    eventsApplied: 0,
    byYear: {}
  };

  _.forEach(credits, (credit) => {
    const year = _.get(credit, 'academicYear', 'unknown');
    const pts = math.bignumber(_.get(credit, 'points', 0));
    const type = _.get(credit, 'type', '');
    const status = _.get(credit, 'status', '').toLowerCase();
    const appealStatus = _.get(credit, 'appeal.status', '').toLowerCase();

    // Ensure year entry exists
    if (!stats.byYear[year]) {
      stats.byYear[year] = {
        positive: math.bignumber(0),
        negative: math.bignumber(0), // stored as positive deduction amount
        net: math.bignumber(0),
        posCount: 0,
        negCount: 0
      };
    }

    const yearData = stats.byYear[year];

    if (type === 'positive' && status === 'approved') {
      yearData.positive = math.add(yearData.positive, pts);
      yearData.net = math.add(yearData.net, pts);
      yearData.posCount++;
      
      stats.totalPositive = math.add(stats.totalPositive, pts);
      stats.runningTotal = math.add(stats.runningTotal, pts);
      stats.eventsApplied++;
    } 
    else if (type === 'negative') {
      // Apply if (no appeal AND approved) OR (appeal AND rejected)
      const shouldApply = appealStatus ? (appealStatus === 'rejected') : (status === 'approved');
      
      if (shouldApply) {
        const deduction = math.abs(pts);
        yearData.negative = math.add(yearData.negative, deduction);
        yearData.net = math.subtract(yearData.net, deduction);
        yearData.negCount++;

        stats.totalNegative = math.add(stats.totalNegative, deduction);
        stats.runningTotal = math.subtract(stats.runningTotal, deduction);
        stats.eventsApplied++;
      }
    }
  });

  // Convert bignumbers back to numbers for the final result
  return {
    runningTotal: math.number(stats.runningTotal),
    totalPositive: math.number(stats.totalPositive),
    totalNegative: math.number(stats.totalNegative),
    eventsApplied: stats.eventsApplied,
    positiveByYear: _.mapValues(stats.byYear, y => math.number(y.positive)),
    negativeByYear: _.mapValues(stats.byYear, y => math.number(y.negative)),
    netByYear: _.mapValues(stats.byYear, y => math.number(y.net)),
    positiveCountByYear: _.mapValues(stats.byYear, y => y.posCount),
    negativeCountByYear: _.mapValues(stats.byYear, y => y.negCount)
  };
}

/**
 * Persist the recalculated credits back to the user record.
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
    user.currentCredit = metrics.runningTotal;
    user.creditsByYear = metrics.netByYear;
    user.updatedAt = updatePayload.updatedAt;
    await user.save();
  }
}

/**
 * Main Recalculation Entry Point
 */
async function recalcFacultyCredits(facultyId) {
  try {
    const user = await fetchUser(facultyId);
    const credits = await fetchAndSortCredits(facultyId);
    const metrics = processCredits(credits);
    await updateUserCredits(user, metrics);

    return {
      ...metrics,
      netTotal: metrics.runningTotal
    };
  } catch (err) {
    throw new Error(`recalcFacultyCredits failed: ${err.message}`);
  }
}

module.exports = {
  recalcFacultyCredits,
  fetchUser,
  fetchAndSortCredits,
  processCredits,
  updateUserCredits,
};

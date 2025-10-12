// utils/generateID.js
const { v4: uuidv4 } = require('uuid');

/**
 * Generates faculty IDs:
 * - For Engineering College: EGSP/EC/<5digit>
 * - For Arts and Science College: EGSP/ASC/<5digit>
 */
function generateFacultyID(collegeName) {
  const rand5 = Math.floor(Math.random() * 90000) + 10000; // 10000-99999
  const normalized = (collegeName || '').toLowerCase();
  if (normalized.includes('engineering') || normalized.includes('ec')) {
    return `EGSP/EC/${rand5}`;
  }
  // default to arts and science
  return `EGSP/ASC/${rand5}`;
}

// API Key generator
function generateApiKey() {
  return `ak_${uuidv4().replace(/-/g, '')}`;
}

module.exports = { generateFacultyID, generateApiKey };

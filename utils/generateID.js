// utils/generateID.js
const { v4: uuidv4 } = require('uuid');

/**
 * Generates faculty IDs with institution-specific prefixes
 * 
 * Examples:
 *  - Engineering College → EGSP/EC/xxxxx
 *  - Arts and Science College → EGSP/ASC/xxxxx
 *  - Polytechnic College → EGSP/PC/xxxxx
 *  - Nursing College → EGSP/NUR/xxxxx
 *  - College of Education → EGSP/EDU/xxxxx
 *  - College of Pharmacy → EGSP/PHARM/xxxxx
 *  - Naturopathy & Yogic Sciences → EGSP/NYS/xxxxx
 */
function generateFacultyID(collegeName = '') {
  const rand5 = Math.floor(Math.random() * 90000) + 10000; // 10000–99999
  const name = collegeName.toLowerCase();

  if (name.includes('engineering')) return `EGSP/EC/${rand5}`;
  if (name.includes('arts') || name.includes('science')) return `EGSP/ASC/${rand5}`;
  if (name.includes('polytechnic')) return `EGSP/PC/${rand5}`;
  if (name.includes('nursing')) return `EGSP/NUR/${rand5}`;
  if (name.includes('education')) return `EGSP/EDU/${rand5}`;
  if (name.includes('pharmacy')) return `EGSP/PHARM/${rand5}`;
  if (name.includes('naturopathy') || name.includes('yogic')) return `EGSP/NYS/${rand5}`;

  // Default fallback
  return `EGSP/GEN/${rand5}`;
}

/**
 * Generates unique API Key for users or faculty
 * Example: ak_8f9e3b2a49f44b7a8e2efc443a7a90d5
 */
function generateApiKey() {
  return `ak_${uuidv4().replace(/-/g, '')}`;
}

module.exports = { generateFacultyID, generateApiKey };

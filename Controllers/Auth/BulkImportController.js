const XLSX = require('xlsx');
const User = require('../../Models/User');
const bcrypt = require('bcryptjs');
const { getSettings, placement } = require('../../domain/applicationSettings');
const { generateFacultyID, generateApiKey } = require('../../utils/generateID');
// If "utils" is at root, it is ../../../utils
// Actually path in original file was '../utils/email', so it is one level up from Controllers.
// From `Controllers/Auth/`, it is `../../utils`.

/**
 * Bulk user registration
 */
async function bulkRegister(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });

    // Read buffer
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!rows.length) return res.status(400).json({ success: false, message: 'Empty file' });
    if (rows.length > 1000)
      return res.status(400).json({ success: false, message: 'Import up to 1000 users at a time' });
    const settings = await getSettings();

    // 1. Pre-fetch existing emails to avoid N+1 queries
    // Warning: fetching ALL users might be heavy. In production, use a projection if possible.
    const allUsers = await User.find();
    const existingEmails = new Set(allUsers.map((u) => u.email.toLowerCase()));

    const results = [];

    // 2. Process rows (Hashing is slow, so we do it in parallel or chunks if needed, but sequential is safer for CPU)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const email = String(row.email || row.Email || '')
        .trim()
        .toLowerCase();
      const name = String(row.name || row.Name || '').trim();
      const college = String(row.college || row.College || '').trim();
      const department = String(row.department || row.Department || '').trim();
      const password = String(row.password || row.Password || '');
      const role = String(row.role || row.Role || 'faculty')
        .trim()
        .toLowerCase();

      if (!/^\S+@\S+\.\S+$/.test(email) || existingEmails.has(email)) {
        results.push({ row: i + 2, email, success: false, message: 'Duplicate or invalid email' });
        continue;
      }
      if (
        !name ||
        name.length > 200 ||
        !college ||
        (role === 'faculty' && !department) ||
        !['faculty', 'oa', 'admin'].includes(role) ||
        password.length < settings.passwordMinLength ||
        password.length > 128
      ) {
        results.push({
          row: i + 2,
          email,
          success: false,
          message: `Name, valid role, college, faculty department and a ${settings.passwordMinLength} to 128 character password are required`,
        });
        continue;
      }
      let destination;
      try {
        destination = placement(settings, college, department);
      } catch (error) {
        results.push({ row: i + 2, email, success: false, message: error.message });
        continue;
      }
      const hashed = await bcrypt.hash(password, 12);

      const newUser = {
        name,
        email,
        password: hashed,
        ...destination,
        role,
        facultyID: generateFacultyID(college),
        apiKey: generateApiKey(),
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: String(req.user._id),
        currentCredit: 0,
        totalPositiveCredit: 0,
        totalNegativeCredit: 0,
        creditsByYear: {},
      };

      // 3. Create User
      // Ideally we'd use BatchWriteItem, but User.create uses PutItem.
      // We'll execute creating individually for now to get the ID back.
      try {
        const created = await User.create(newUser);
        existingEmails.add(email); // prevent duplicates within the same file
        results.push({ row: i + 2, success: true, email, role, id: created._id });

        // Queue Email (Fire and forget if not critical)
        // sendWelcomeEmail(created, password).catch(console.error);
      } catch (e) {
        results.push({ row: i + 2, email, success: false, message: e.message });
      }
    }

    return res.json({
      success: true,
      processed: rows.length,
      summary: {
        total: rows.length,
        success: results.filter((item) => item.success).length,
        failed: results.filter((item) => !item.success).length,
      },
      results,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { bulkRegister };

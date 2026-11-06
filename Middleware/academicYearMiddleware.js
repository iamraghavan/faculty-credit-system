const { getSettings } = require('../domain/applicationSettings');
const Credit = require('../Models/Credit');

// Existing records and older clients also use YYYY-YYYY. Preserve their stored
// label while applying the same configured year status to either spelling.
function canonicalYear(value) {
  const full = /^(\d{4})-(\d{4})$/.exec(String(value));
  if (full && Number(full[2]) === Number(full[1]) + 1) return `${full[1]}-${full[2].slice(-2)}`;
  return value;
}

async function requireOpenAcademicYear(req, res, next) {
  try {
    const settings = await getSettings();
    const creditId = req.params.creditId || req.params.id;
    const credit = creditId ? await Credit.findById(creditId) : null;
    const years = [credit?.academicYear, req.body?.academicYear].filter(Boolean);
    if (
      years.some(
        (id) => !settings.academicYears.some((year) => year.id === canonicalYear(id) && year.status === 'open'),
      )
    ) {
      return res
        .status(409)
        .json({
          success: false,
          message: 'This academic year is closed or is not configured. Contact an administrator.',
        });
    }
    next();
  } catch (error) {
    next(error);
  }
}
module.exports = { requireOpenAcademicYear };

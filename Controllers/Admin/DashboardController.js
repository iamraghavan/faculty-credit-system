const User = require('../../Models/User');
const Credit = require('../../Models/Credit');
const { creditImpact } = require('../../domain/creditAccounting');

function canonicalYear(value) {
  const text = String(value || '');
  const full = /^(\d{4})-(\d{4})$/.exec(text);
  if (full && Number(full[2]) === Number(full[1]) + 1) return `${full[1]}-${full[2].slice(-2)}`;
  return text;
}

function validMonth(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 7);
}

async function getDashboardOverview(req, res, next) {
  try {
    const requestedYear = String(req.query.academicYear || '').trim();
    if (requestedYear && !/^\d{4}-(?:\d{2}|\d{4})$/.test(requestedYear)) {
      return res.status(400).json({ success: false, message: 'Invalid academic year' });
    }
    const academicYear = canonicalYear(requestedYear);
    const [users, allCredits] = await Promise.all([User.find(), Credit.find()]);
    const usersById = new Map(users.map((user) => [String(user._id), user]));
    const credits = allCredits.filter(
      (credit) => credit.status !== 'deleted' && (!academicYear || canonicalYear(credit.academicYear) === academicYear),
    );
    const faculty = users.filter((user) => user.role === 'faculty');
    const activeUsers = users.filter((user) => user.isActive !== false).length;
    const pendingReview = credits.filter((credit) => credit.type === 'positive' && credit.status === 'pending').length;
    const openAppeals = credits.filter((credit) => credit.appeal?.status === 'pending').length;
    const positiveDecided = credits.filter(
      (credit) => credit.type === 'positive' && ['approved', 'rejected'].includes(credit.status),
    );
    const approved = positiveDecided.filter((credit) => credit.status === 'approved').length;
    const approvalRate = positiveDecided.length ? Math.round((approved / positiveDecided.length) * 100) : 0;
    const netPoints = credits.reduce((sum, credit) => sum + creditImpact(credit).points, 0);

    const status = { pending: 0, approved: 0, rejected: 0 };
    const trend = new Map();
    const college = new Map();
    const growth = new Map();
    for (const user of users) {
      const name = String(user.college || 'Unassigned');
      const row = college.get(name) || { name, users: 0, records: 0 };
      row.users++;
      college.set(name, row);
      const month = validMonth(user.createdAt);
      if (month) growth.set(month, (growth.get(month) || 0) + 1);
    }
    for (const credit of credits) {
      if (credit.type === 'positive' && Object.hasOwn(status, credit.status)) status[credit.status]++;
      const month = validMonth(credit.createdAt);
      if (month) {
        const row = trend.get(month) || { month, submitted: 0, approved: 0, rejected: 0, negative: 0 };
        if (credit.type === 'positive') {
          row.submitted++;
          if (credit.status === 'approved') row.approved++;
          if (credit.status === 'rejected') row.rejected++;
        } else if (credit.type === 'negative') row.negative++;
        trend.set(month, row);
      }
      const name = String(
        credit.facultySnapshot?.college || usersById.get(String(credit.faculty))?.college || 'Unassigned',
      );
      const row = college.get(name) || { name, users: 0, records: 0 };
      row.records++;
      college.set(name, row);
    }
    const recent = [...credits]
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 6)
      .map((credit) => ({
        id: String(credit._id),
        title: String(
          credit.title ||
            credit.creditTitle?.title ||
            (typeof credit.creditTitle === 'string' ? credit.creditTitle : '') ||
            'Credit record',
        ),
        faculty: String(
          credit.facultySnapshot?.name || usersById.get(String(credit.faculty))?.name || 'Unknown faculty',
        ),
        college: String(credit.facultySnapshot?.college || ''),
        type: credit.type,
        status: credit.status,
        points: Number(credit.points) || 0,
        impact: creditImpact(credit).points,
        createdAt: credit.createdAt,
      }));

    return res.json({
      success: true,
      academicYear: academicYear || null,
      generatedAt: new Date().toISOString(),
      summary: {
        totalUsers: users.length,
        activeUsers,
        facultyUsers: faculty.length,
        colleges: [...college.values()].filter((item) => item.users > 0).length,
        totalRecords: credits.length,
        pendingReview,
        openAppeals,
        netPoints,
        approvalRate,
      },
      status,
      trends: [...trend.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-12),
      colleges: [...college.values()]
        .sort((a, b) => b.records - a.records || b.users - a.users || a.name.localeCompare(b.name))
        .slice(0, 8),
      userGrowth: [...growth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12)
        .map(([month, users]) => ({ month, users })),
      recent,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getDashboardOverview };

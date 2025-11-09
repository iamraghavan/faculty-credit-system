const User = require('../Models/User');
const Credit = require('../Models/Credit');
const CreditTitle = require('../Models/CreditTitle');

exports.getUserAnalytics = async (req, res, next) => {
  try {
    const users = await User.find();
    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.isActive).length;
    const mfaEnabledUsers = users.filter(u => u.mfaEnabled).length;

    // Aggregate credits by department
    const departmentCredits = {};
    for (const u of users) {
      const dept = u.department || 'Unknown';
      departmentCredits[dept] = (departmentCredits[dept] || 0) + (u.currentCredit || 0);
    }

    // User growth over time (by month)
    const userGrowth = {};
    for (const u of users) {
      const month = new Date(u.createdAt).toISOString().slice(0, 7); // YYYY-MM
      userGrowth[month] = (userGrowth[month] || 0) + 1;
    }

    res.json({
      success: true,
      totalUsers,
      activeUsers,
      mfaAdoptionRate: (mfaEnabledUsers / totalUsers * 100).toFixed(2),
      departmentCredits,
      userGrowth
    });
  } catch (err) {
    next(err);
  }
};


exports.getCreditAnalytics = async (req, res, next) => {
  try {
    const credits = await Credit.find();
    const totalCredits = credits.length;

    const byStatus = {};
    const byType = {};
    const byMonth = {};
    const facultyPoints = {};
    let appealCount = 0;
    let totalPoints = 0;

    for (const c of credits) {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      byType[c.type] = (byType[c.type] || 0) + 1;
      totalPoints += c.points || 0;

      const month = new Date(c.createdAt).toISOString().slice(0, 7);
      byMonth[month] = (byMonth[month] || 0) + 1;

      const facultyId = c.faculty || 'Unknown';
      facultyPoints[facultyId] = (facultyPoints[facultyId] || 0) + (c.points || 0);

      if (c.appealCount > 0) appealCount++;
    }

    // Leaderboard - top 10
    const topFaculty = Object.entries(facultyPoints)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([faculty, points]) => ({ faculty, points }));

    res.json({
      success: true,
      totalCredits,
      byStatus,
      byType,
      appealStats: {
        totalAppeals: appealCount,
        percentAppealed: ((appealCount / totalCredits) * 100).toFixed(2)
      },
      averagePointsPerFaculty: (totalPoints / Object.keys(facultyPoints).length).toFixed(2),
      topFaculty,
      byMonth
    });
  } catch (err) {
    next(err);
  }
};

exports.getCreditTitleAnalytics = async (req, res, next) => {
  try {
    const titles = await CreditTitle.find();
    const credits = await Credit.find();

    const totalActive = titles.filter(t => t.isActive).length;
    const avgPoints =
      titles.reduce((sum, t) => sum + (t.points || 0), 0) / (titles.length || 1);

    // Count how many credits use each title
    const usageCount = {};
    for (const c of credits) {
      const title = c.creditTitle || 'Unknown';
      usageCount[title] = (usageCount[title] || 0) + 1;
    }

    const mostUsed = Object.entries(usageCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([title, count]) => ({ title, count }));

    // Titles created over time
    const createdTrend = {};
    for (const t of titles) {
      const month = new Date(t.createdAt).toISOString().slice(0, 7);
      createdTrend[month] = (createdTrend[month] || 0) + 1;
    }

    res.json({
      success: true,
      totalTitles: titles.length,
      totalActive,
      avgPoints: avgPoints.toFixed(2),
      mostUsed,
      createdTrend
    });
  } catch (err) {
    next(err);
  }
};

exports.getAcademicYearInsights = async (req, res, next) => {
  try {
    const credits = await Credit.find();
    const byYear = {};
    const byDeptYear = {};

    for (const c of credits) {
      const year = c.academicYear || 'Unknown';
      const dept = c.facultySnapshot?.department || 'Unknown';
      const pts = c.points || 0;

      if (!byYear[year]) byYear[year] = { totalCredits: 0, totalPoints: 0 };
      byYear[year].totalCredits++;
      byYear[year].totalPoints += pts;

      if (!byDeptYear[dept]) byDeptYear[dept] = {};
      byDeptYear[dept][year] = (byDeptYear[dept][year] || 0) + pts;
    }

    // Year-on-year growth
    const sortedYears = Object.keys(byYear).sort();
    const growth = [];
    for (let i = 1; i < sortedYears.length; i++) {
      const prev = byYear[sortedYears[i - 1]].totalPoints;
      const curr = byYear[sortedYears[i]].totalPoints;
      const diff = curr - prev;
      const pct = prev ? ((diff / prev) * 100).toFixed(2) : 'N/A';
      growth.push({
        year: sortedYears[i],
        growthPercent: pct,
        diff
      });
    }

    res.json({
      success: true,
      byYear,
      byDeptYear,
      growth
    });
  } catch (err) {
    next(err);
  }
};

exports.getCreditTrends = async (req, res, next) => {
  try {
    const allCredits = await Credit.find();

    // Helper to format date (YYYY-MM-DD)
    const formatDate = (date) => new Date(date).toISOString().split('T')[0];

    // Group by day
    const dailyData = {};
    allCredits.forEach((c) => {
      const day = formatDate(c.createdAt);
      if (!dailyData[day]) dailyData[day] = { approved: 0, rejected: 0, pending: 0 };
      dailyData[day][c.status] = (dailyData[day][c.status] || 0) + 1;
    });

    // Convert dailyData to sorted array
    const dailyTrends = Object.entries(dailyData)
      .sort(([a], [b]) => new Date(a) - new Date(b))
      .map(([date, data]) => ({ date, ...data }));

    // Weekly grouping
    const getWeek = (d) => {
      const date = new Date(d);
      const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
      const days = Math.floor((date - firstDayOfYear) / (24 * 60 * 60 * 1000));
      return `W${Math.ceil((days + firstDayOfYear.getDay() + 1) / 7)}-${date.getFullYear()}`;
    };

    const weeklyData = {};
    allCredits.forEach((c) => {
      const week = getWeek(c.createdAt);
      if (!weeklyData[week]) weeklyData[week] = { approved: 0, rejected: 0, pending: 0 };
      weeklyData[week][c.status] = (weeklyData[week][c.status] || 0) + 1;
    });

    const weeklyTrends = Object.entries(weeklyData).map(([week, data]) => ({ week, ...data }));

    // Monthly grouping
    const monthlyData = {};
    allCredits.forEach((c) => {
      const month = new Date(c.createdAt).toISOString().slice(0, 7); // YYYY-MM
      if (!monthlyData[month]) monthlyData[month] = { approved: 0, rejected: 0, pending: 0 };
      monthlyData[month][c.status] = (monthlyData[month][c.status] || 0) + 1;
    });

    const monthlyTrends = Object.entries(monthlyData).map(([month, data]) => ({ month, ...data }));

    res.json({
      success: true,
      message: 'Credit trends fetched successfully',
      daily: dailyTrends,
      weekly: weeklyTrends,
      monthly: monthlyTrends,
    });
  } catch (err) {
    next(err);
  }
};

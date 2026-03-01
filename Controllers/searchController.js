const User = require('../Models/User');
const Credit = require('../Models/Credit');
const CreditTitle = require('../Models/CreditTitle');

/**
 * Global Search Controller
 * GET /api/v1/search?q=query
 */
async function globalSearch(req, res, next) {
  try {
    const { q } = req.query;
    if (!q || q.trim().length === 0) {
      return res.json({ success: true, results: [] });
    }

    const query = q.toLowerCase().trim();
    const user = req.user;
    const results = [];

    // 1. Search Logic for Faculty
    if (user.role === 'faculty') {
      // Faculty search only THEIR credits
      const facultyId = String(user._id || user.id);
      const credits = await Credit.find({ faculty: facultyId });
      
      const filteredCredits = credits.filter(c => 
        String(c.title || '').toLowerCase().includes(query) ||
        String(c.notes || '').toLowerCase().includes(query) ||
        String(c.academicYear || '').toLowerCase().includes(query)
      );

      // Group faculty results
      if (filteredCredits.length > 0) {
        results.push({
          category: 'My Credits',
          items: filteredCredits.map(c => ({
            id: c._id,
            title: c.title,
            subtitle: `${c.type.toUpperCase()} | ${c.points} pts | ${c.academicYear}`,
            type: c.type,
            url: `/u/credits/${c._id}`
          }))
        });
      }
    } 
    
    // 2. Search Logic for Admin / OA
    else if (['admin', 'oa'].includes(user.role)) {
      // Admin/OA can search everything

      // A. Search Users
      const allUsers = await User.find();
      const filteredUsers = allUsers.filter(u => 
        String(u.name || '').toLowerCase().includes(query) ||
        String(u.email || '').toLowerCase().includes(query) ||
        String(u.facultyID || '').toLowerCase().includes(query) ||
        String(u.department || '').toLowerCase().includes(query)
      );

      if (filteredUsers.length > 0) {
        results.push({
          category: 'Users',
          items: filteredUsers.map(u => ({
            id: u._id || u.id,
            title: u.name,
            subtitle: `${u.role.toUpperCase()} | ${u.facultyID} | ${u.department}`,
            url: `/admin/users/${u._id || u.id}`
          }))
        });
      }

      // B. Search All Credits
      const allCredits = await Credit.find();
      const filteredCredits = allCredits.filter(c => 
        String(c.title || '').toLowerCase().includes(query) ||
        String(c.facultySnapshot?.name || '').toLowerCase().includes(query) ||
        String(c.facultySnapshot?.facultyID || '').toLowerCase().includes(query)
      );

      // Categorize credits by type
      const pos = filteredCredits.filter(c => c.type === 'positive');
      const neg = filteredCredits.filter(c => c.type === 'negative');

      if (pos.length > 0) {
        results.push({
          category: 'Positive Credits',
          items: pos.map(c => ({
            id: c._id,
            title: c.title,
            subtitle: `${c.facultySnapshot?.name} | ${c.points} pts | ${c.status}`,
            url: `/admin/credits/positive/${c._id}`
          }))
        });
      }

      if (neg.length > 0) {
        results.push({
          category: 'Negative Credits',
          items: neg.map(c => ({
            id: c._id,
            title: c.title,
            subtitle: `${c.facultySnapshot?.name} | ${Math.abs(c.points)} pts | ${c.status}`,
            url: `/admin/credits/negative/${c._id}`
          }))
        });
      }

      // C. Search Credit Titles (Configuration)
      const titles = await CreditTitle.find();
      const filteredTitles = titles.filter(t => 
        String(t.title || '').toLowerCase().includes(query) ||
        String(t.description || '').toLowerCase().includes(query)
      );

      if (filteredTitles.length > 0) {
        results.push({
          category: 'Credit Categories',
          items: filteredTitles.map(t => ({
            id: t._id,
            title: t.title,
            subtitle: `${t.points} pts | ${t.type || 'N/A'}`,
            url: `/admin/settings/titles/${t._id}`
          }))
        });
      }
    }

    res.json({
      success: true,
      query: q,
      results
    });

  } catch (err) {
    next(err);
  }
}

module.exports = { globalSearch };

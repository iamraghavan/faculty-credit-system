const Settings = require('../../Models/ApplicationSettings');
const User = require('../../Models/User');
const { getSettings, validateSettings, placement } = require('../../domain/applicationSettings');

async function getConfiguration(req, res, next) {
  try {
    const data = await getSettings();
    // Configuration is available to signed-in users; audit metadata is administrative.
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      const { audit, updatedBy, ...publicData } = data;
      return res.json({ success: true, data: publicData });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function updateConfiguration(req, res, next) {
  try {
    const value = validateSettings(req.body);
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 300000)
      return res
        .status(400)
        .json({
          success: false,
          message: 'Configuration is too large. Reduce the number or length of directory entries.',
        });
    const previous = await getSettings();
    if (value.revision !== previous.revision)
      return res.status(409).json({ success: false, message: 'Settings changed. Reload before saving.' });
    // Used placements and historical years are retained; archive instead of deleting.
    const users = await User.find();
    for (const user of users) {
      if (!user.college) continue;
      try {
        placement(value, user.college, user.department, { allowInactive: true });
      } catch {
        return res
          .status(409)
          .json({
            success: false,
            message: `Transfer users out of ${user.college} / ${user.department || 'unassigned'} before removing or renaming it.`,
          });
      }
    }
    for (const year of previous.academicYears) {
      if (!value.academicYears.some((item) => item.id === year.id))
        return res
          .status(409)
          .json({ success: false, message: 'Existing academic years must be closed rather than deleted.' });
    }
    for (const college of previous.colleges) {
      const replacement = value.colleges.find((item) => item.id === college.id);
      if (
        replacement &&
        replacement.institutionId !== college.institutionId &&
        users.some((user) => user.college === college.name)
      ) {
        return res
          .status(409)
          .json({ success: false, message: 'Transfer users before changing a college’s parent institution.' });
      }
    }
    const now = new Date().toISOString();
    const changed = Object.keys(value).filter(
      (key) => key !== 'revision' && JSON.stringify(value[key]) !== JSON.stringify(previous[key]),
    );
    const data = await Settings.save(
      {
        ...value,
        updatedAt: now,
        updatedBy: String(req.user._id),
        audit: [
          ...(previous.audit || []),
          { at: now, by: String(req.user._id), actor: req.user.name, fields: changed },
        ].slice(-100),
      },
      value.revision,
    );
    res.json({ success: true, data });
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException')
      return res.status(409).json({ success: false, message: 'Settings changed. Reload before saving.' });
    next(error);
  }
}
module.exports = { getConfiguration, updateConfiguration };

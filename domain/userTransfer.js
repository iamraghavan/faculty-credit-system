const { randomUUID } = require('crypto');
const Session = require('../Models/Session');
const { getSettings, placement } = require('./applicationSettings');

async function transferChanges(user, input, actor) {
  const settings = await getSettings();
  if (!settings.transfersEnabled)
    throw Object.assign(new Error('User transfers are disabled in application settings'), { status: 409 });
  if (user.role === 'superadmin') throw Object.assign(new Error('Superadmin placement is protected'), { status: 403 });
  const destination = placement(settings, String(input.college || '').trim(), String(input.department || '').trim());
  if (user.role === 'faculty' && !destination.department)
    throw Object.assign(new Error('Faculty requires a department'), { status: 400 });
  const reason = String(input.reason || '').trim();
  if ((settings.requireTransferReason && !reason) || reason.length > 1000)
    throw Object.assign(new Error('Provide a transfer reason of up to 1000 characters'), { status: 400 });
  if (destination.college === user.college && destination.department === (user.department || ''))
    throw Object.assign(new Error('The user is already in this college and department'), { status: 409 });
  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    at: now,
    by: String(actor._id),
    actor: actor.name,
    from: {
      institutionId:
        user.institutionId || settings.colleges.find((item) => item.name === user.college)?.institutionId || '',
      college: user.college || '',
      department: user.department || '',
    },
    to: destination,
    reason,
  };
  const previous = user.employment?.current || {
    employeeId: user.facultyID || '',
    college: user.college || '',
    department: user.department || '',
    designation: user.designation || '',
    status: user.isActive === false ? 'inactive' : 'active',
  };
  return {
    ...destination,
    updatedAt: now,
    updatedBy: String(actor._id),
    transferHistory: [...(user.transferHistory || []), record],
    employment: {
      current: {
        ...previous,
        college: destination.college,
        department: destination.department,
        effectiveFrom: now.slice(0, 10),
      },
      history: [
        ...(user.employment?.history || []),
        { ...previous, replacedAt: now, replacedBy: String(actor._id), reason },
      ],
    },
    profileVersion: Number(user.profileVersion || 1) + 1,
  };
}

async function revokeSessions(id) {
  const sessions = await Session.findByUserId(String(id));
  await Promise.all(sessions.map((session) => Session.revoke(session._id)));
}
module.exports = { transferChanges, revokeSessions };

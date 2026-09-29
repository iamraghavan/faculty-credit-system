const ROLE_PERMISSIONS = Object.freeze({
  superadmin: ['*'],
  admin: [
    'user.read', 'user.create', 'user.update', 'user.deactivate',
    'profile.read:self', 'profile.update:self', 'profile.read:any', 'profile.update:any',
    'credit.read:any', 'credit.review', 'credit.issue',
    'credit.title.read', 'credit.title.manage',
    'appeal.read:any', 'appeal.resolve',
    'report.read', 'report.export',
    'policy.read', 'policy.draft', 'policy.publish', 'policy.retire',
    'export.official',
    'notification.broadcast',
  ],
  oa: [
    'user.read:faculty', 'profile.read:self', 'profile.update:self',
    'credit.read:own-issued', 'credit.edit:own-issued', 'credit.void:own-issued', 'credit.issue',
    'credit.title.read',
    'appeal.read:own-issued', 'policy.read',
  ],
  faculty: [
    'profile.read:self', 'profile.update:self',
    'credit.read:self', 'credit.submit',
    'credit.title.read',
    'appeal.read:self', 'appeal.create',
  ],
});

function permissionsFor(user) {
  const rolePermissions = ROLE_PERMISSIONS[user?.role] || [];
  const overrides = Array.isArray(user?.permissionOverrides) ? user.permissionOverrides : [];
  const denied = new Set(overrides.filter(value => String(value).startsWith('-')).map(value => String(value).slice(1)));
  const grants = ['admin', 'superadmin'].includes(user?.role)
    ? overrides.filter(value => !String(value).startsWith('-')) : [];
  return [...new Set([...rolePermissions, ...grants])]
    .filter(permission => !denied.has(permission));
}

function hasPermission(user, permission) {
  const permissions = permissionsFor(user);
  return permissions.includes('*') || permissions.includes(permission);
}

module.exports = { ROLE_PERMISSIONS, permissionsFor, hasPermission };

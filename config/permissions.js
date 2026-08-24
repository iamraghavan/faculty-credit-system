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
    'user.read', 'profile.read:self', 'profile.update:self', 'profile.read:any',
    'credit.read:any', 'credit.review', 'credit.issue',
    'credit.title.read',
    'appeal.read:any', 'appeal.resolve',
    'report.read', 'report.export', 'policy.read', 'export.official',
    'notification.broadcast',
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
  return [...new Set([...rolePermissions, ...overrides.filter(value => !String(value).startsWith('-'))])]
    .filter(permission => !denied.has(permission));
}

function hasPermission(user, permission) {
  const permissions = permissionsFor(user);
  return permissions.includes('*') || permissions.includes(permission);
}

module.exports = { ROLE_PERMISSIONS, permissionsFor, hasPermission };

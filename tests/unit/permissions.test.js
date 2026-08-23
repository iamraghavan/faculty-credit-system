const { permissionsFor, hasPermission } = require('../../config/permissions');

describe('role permissions', () => {
  test('faculty cannot publish policies or read all users', () => {
    expect(hasPermission({ role: 'faculty' }, 'policy.publish')).toBe(false);
    expect(hasPermission({ role: 'faculty' }, 'user.read')).toBe(false);
  });

  test('explicit denial overrides role grant', () => {
    const user = { role: 'admin', permissionOverrides: ['-report.export', 'custom.permission'] };
    expect(permissionsFor(user)).toContain('custom.permission');
    expect(hasPermission(user, 'report.export')).toBe(false);
  });

  test('superadmin has every permission', () => {
    expect(hasPermission({ role: 'superadmin' }, 'policy.publish')).toBe(true);
  });
});

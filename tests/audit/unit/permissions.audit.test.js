/**
 * Audit: role -> permission model and the role-guard middleware.
 */
const { ROLE_PERMISSIONS, permissionsFor, hasPermission } = require('../../../config/permissions');
const {
  adminOnly, adminOrOA, AdminMiddleware, oaAlso, requirePermission, requireAnyPermission, requireSelfOrPermission,
} = require('../../../Middleware/authMiddleware');

function run(mw, user, params = {}) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
  let called = false;
  mw({ user, params }, res, () => { called = true; });
  return called ? 'next' : res.statusCode;
}
const U = (role, extra = {}) => ({ _id: `${role}-id`, role, ...extra });

describe('permission lists', () => {
  test('roles are frozen (cannot be changed at runtime)', () => {
    expect(Object.isFrozen(ROLE_PERMISSIONS)).toBe(true);
  });
  test('faculty cannot issue, review or manage', () => {
    for (const p of ['credit.issue', 'credit.review', 'user.create', 'user.update', 'report.read', 'policy.publish', 'notification.broadcast', 'credit.read:any']) {
      expect(hasPermission(U('faculty'), p)).toBe(false);
    }
  });
  test('OA can issue but not review/approve or manage users', () => {
    expect(hasPermission(U('oa'), 'credit.issue')).toBe(true);
    for (const p of ['credit.review', 'user.create', 'user.update', 'credit.read:any', 'report.read', 'policy.publish']) {
      expect(hasPermission(U('oa'), p)).toBe(false);
    }
  });
  test('superadmin has every permission (wildcard)', () => {
    expect(hasPermission(U('superadmin'), 'anything.at.all')).toBe(true);
  });
  test('unknown, missing or null role gets nothing', () => {
    expect(permissionsFor(U('hacker'))).toEqual([]);
    expect(permissionsFor({})).toEqual([]);
    expect(permissionsFor(null)).toEqual([]);
  });
  test('"-perm" override removes a permission', () => {
    expect(hasPermission(U('admin', { permissionOverrides: ['-credit.issue'] }), 'credit.issue')).toBe(false);
  });
  test('grant overrides only apply to admin roles (faculty cannot self-grant)', () => {
    expect(hasPermission(U('faculty', { permissionOverrides: ['credit.review'] }), 'credit.review')).toBe(false);
    expect(hasPermission(U('admin', { permissionOverrides: ['custom.thing'] }), 'custom.thing')).toBe(true);
  });
  test('denying "*" does NOT remove superadmin wildcard of a specific permission', () => {
    // Documents behaviour: a superadmin cannot be restricted with "-x" because '*' still matches.
    expect(hasPermission(U('superadmin', { permissionOverrides: ['-user.create'] }), 'user.create')).toBe(true);
  });
});

describe('role guard middleware', () => {
  const roles = ['faculty', 'oa', 'admin', 'superadmin'];
  test.each(roles)('adminOnly with %s', (r) => {
    expect(run(adminOnly, U(r))).toBe(['admin', 'superadmin'].includes(r) ? 'next' : 403);
  });
  test.each(roles)('adminOrOA with %s', (r) => {
    expect(run(adminOrOA, U(r))).toBe(r === 'faculty' ? 403 : 'next');
  });
  test.each(roles)('AdminMiddleware (superadmin only) with %s', (r) => {
    expect(run(AdminMiddleware, U(r))).toBe(r === 'superadmin' ? 'next' : 403);
  });
  test('oaAlso lets ONLY oa through despite its "Admin & OA" message', () => {
    expect(run(oaAlso, U('oa'))).toBe('next');
    expect(run(oaAlso, U('admin'))).toBe(403);
  });
  test('no user -> 403 / 401', () => {
    expect(run(adminOnly, undefined)).toBe(403);
    expect(run(requirePermission('credit.issue'), undefined)).toBe(401);
    expect(run(requireAnyPermission('a'), undefined)).toBe(401);
  });
  test('requirePermission', () => {
    expect(run(requirePermission('credit.issue'), U('oa'))).toBe('next');
    expect(run(requirePermission('credit.issue'), U('faculty'))).toBe(403);
  });
  test('requireAnyPermission', () => {
    expect(run(requireAnyPermission('user.read', 'user.read:faculty'), U('oa'))).toBe('next');
    expect(run(requireAnyPermission('user.read', 'user.read:faculty'), U('faculty'))).toBe(403);
  });
  test('requireSelfOrPermission: self allowed, other faculty blocked, admin allowed', () => {
    const mw = requireSelfOrPermission('facultyId', 'credit.read:any');
    expect(run(mw, U('faculty'), { facultyId: 'faculty-id' })).toBe('next');
    expect(run(mw, U('faculty'), { facultyId: 'someone-else' })).toBe(403);
    expect(run(mw, U('admin'), { facultyId: 'someone-else' })).toBe('next');
    expect(run(mw, U('oa'), { facultyId: 'someone-else' })).toBe(403);
  });
});

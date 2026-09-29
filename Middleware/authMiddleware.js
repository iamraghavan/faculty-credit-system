const jwt = require('jsonwebtoken');
const User = require('../Models/User');
const Session = require('../Models/Session');
const { hasPermission, permissionsFor } = require('../config/permissions');

async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (user.isActive === false) return res.status(403).json({ success: false, message: 'Account is inactive' });

    if (decoded.sessionId) {
      const session = await Session.findById(decoded.sessionId);
      const expired = !session?.expiresAt || new Date(session.expiresAt).getTime() <= Date.now();
      if (!session || !session.isValid || expired || String(session.userId) !== String(user._id || user.id)) {
        return res.status(401).json({ success: false, message: 'Session expired or revoked' });
      }
      req.session = session;
    } else if (String(process.env.REQUIRE_SESSION_VALIDATION).toLowerCase() === 'true') {
      return res.status(401).json({ success: false, message: 'Legacy token is no longer accepted' });
    }

    req.user = user;
    req.auth = decoded;
    req.user.permissions = permissionsFor(user);
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// Admin middleware
function AdminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Super admin only' });
  }
  next();
}

function adminOnly(req, res, next) {
  if (!req.user || !['admin', 'superadmin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden - Admin only' });
  }
  next();
}

function oaAlso(req, res, next) {
  if (!req.user || req.user.role !== 'oa') {
    return res.status(403).json({ success: false, message: 'Forbidden - Admin & OA only' });
  }
  next();
}

function adminOrOA(req, res, next) {
  if (!req.user || !['admin', 'oa', 'superadmin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden - Admin or OA only' });
  }
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ success: false, message: `Missing permission: ${permission}` });
    }
    next();
  };
}

function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (permissions.some(permission => hasPermission(req.user, permission))) return next();
    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  };
}

function requireSelfOrPermission(paramName, permission) {
  return (req, res, next) => {
    const requestedId = String(req.params[paramName]);
    const ownId = String(req.user?._id || req.user?.id || '');
    if (requestedId === ownId || hasPermission(req.user, permission)) return next();
    return res.status(403).json({ success: false, message: 'You cannot access another faculty member\'s record' });
  };
}


module.exports = { adminOrOA, oaAlso, authMiddleware, AdminMiddleware, adminOnly, requirePermission, requireAnyPermission, requireSelfOrPermission };

const jwt = require('jsonwebtoken');
const User = require('../Models/User');

async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    req.user = user;
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
  if (!req.user || req.user.role !== 'admin') {
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
  if (!req.user || !['admin', 'oa'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden - Admin or OA only' });
  }
  next();
}


module.exports = { adminOrOA, oaAlso, authMiddleware, AdminMiddleware, adminOnly };

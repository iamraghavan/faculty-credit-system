const jwt = require('jsonwebtoken');
const User = require('../../Models/User');
const { authMiddleware, AdminMiddleware, adminOnly, adminOrOA } = require('../../Middleware/authMiddleware');

jest.mock('jsonwebtoken');
jest.mock('../../Models/User');

describe('Auth Middleware Security Tests', () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {}, query: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
    process.env.JWT_SECRET = 'test-secret';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('authMiddleware (JWT Validation)', () => {
    it('should block request without token', async () => {
      await authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Unauthorized' });
    });

    it('should block request with invalid token', async () => {
      req.headers.authorization = 'Bearer invalid-token';
      jwt.verify.mockImplementation(() => { throw new Error('Invalid token'); });

      await authMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Invalid token' });
    });

    it('should authenticate user with valid token', async () => {
      req.headers.authorization = 'Bearer valid-token';
      jwt.verify.mockReturnValue({ id: 'user123' });
      User.findById.mockResolvedValue({ id: 'user123', name: 'Test User' });

      await authMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
    });
  });

  describe('Role-Based Access Control (RBAC)', () => {
    it('AdminMiddleware should block regular users', () => {
      req.user = { role: 'user' };
      AdminMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Super admin only' });
    });

    it('AdminMiddleware should allow superadmin', () => {
      req.user = { role: 'superadmin' };
      AdminMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('adminOnly should block superadmin (based on strict equality)', () => {
      req.user = { role: 'superadmin' };
      adminOnly(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('adminOnly should allow admin', () => {
      req.user = { role: 'admin' };
      adminOnly(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('adminOrOA should allow oa and admin', () => {
      req.user = { role: 'oa' };
      adminOrOA(req, res, next);
      expect(next).toHaveBeenCalled();

      req.user = { role: 'admin' };
      adminOrOA(req, res, next);
      expect(next).toHaveBeenCalledTimes(2);
    });
  });
});

// Routes/notificationRoutes.js
const express = require('express');
const { body, validationResult } = require('express-validator');

const router = express.Router();
const { authMiddleware, adminOnly } = require('../Middleware/authMiddleware'); // use your auth middleware
const { sendRemarkNotification } = require('../Controllers/notificationController');

/**
 * POST /api/v1/notifications/remark
 * Body:
 * {
 *   "facultyId": "603c....",
 *   "remark": {
 *     "title": "Attendance Warning",
 *     "message": "You missed 3 classes in the last month.",
 *     "issuedBy": "Head of Dept"   // optional
 *   }
 * }
 *
 * Protected route (only authenticated users, optionally adminOnly)
 */
router.post(
  '/remark',
  authMiddleware,          
  [
    body('facultyId').exists().withMessage('facultyId is required').isMongoId().withMessage('facultyId must be a valid id'),
    body('remark').exists().withMessage('remark object is required'),
    body('remark.title').exists().withMessage('remark.title required').isString().trim().isLength({ min: 1, max: 200 }),
    body('remark.message').exists().withMessage('remark.message required').isString().trim().isLength({ min: 1, max: 5000 }),
    body('remark.issuedBy').optional().isString().trim().isLength({ max: 200 }),
  ],
  async (req, res, next) => {
    // express-validator result
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    return sendRemarkNotification(req, res, next);
  }
);

module.exports = router;

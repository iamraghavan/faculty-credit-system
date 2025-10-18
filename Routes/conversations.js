// routes/conversations.js
const express = require('express');
const router = express.Router();
const conversationController = require('../Controllers/conversationController');
const authMiddleware = require('../Middleware/authMiddleware');

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @route   POST /api/conversations
 * @desc    Create or fetch a conversation for a credit
 * @access  Authenticated users
 */
router.post('/', conversationController.createConversation);

/**
 * @route   POST /api/conversations/:id/message
 * @desc    Send a message in a conversation (REST fallback if WebSocket unavailable)
 * @access  Participants or admin
 */
router.post('/:id/message', conversationController.sendMessage);

/**
 * @route   GET /api/conversations/:id/messages
 * @desc    Get messages in a conversation (paginated)
 * @query   limit, before (ISO timestamp)
 * @access  Participants or admin
 */
router.get('/:id/messages', conversationController.getMessages);

/**
 * @route   GET /api/conversations
 * @desc    List conversations for the authenticated user (paginated)
 * @query   page, perPage
 * @access  Authenticated users
 */
router.get('/', conversationController.listConversations);

module.exports = router;

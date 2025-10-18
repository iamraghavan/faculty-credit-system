// controllers/conversationController.js
const mongoose = require('mongoose');
const Conversation = require('../Models/Conversation');
const Credit = require('../Models/Credit');
const User = require('../Models/User');
const { decompressSegment } = require('../utils/compression');
const { validationResult } = require('express-validator'); // optional for request validation

/**
 * Create or fetch a conversation for a credit
 * POST /api/conversations
 * Body: { creditId, participantIds: [userId,...] }   // participantIds optional - defaults to credit.faculty + issuedBy
 */
exports.createConversation = async (req, res, next) => {
  try {
    const { creditId, participantIds } = req.body;
    if (!creditId) return res.status(400).json({ error: 'creditId required' });

    const credit = await Credit.findById(creditId);
    if (!credit) return res.status(404).json({ error: 'Credit not found' });

    // Default participants: faculty + issuedBy + current user (if not included)
    const defaultParticipants = new Set();
    defaultParticipants.add(String(credit.faculty));
    if (credit.issuedBy) defaultParticipants.add(String(credit.issuedBy));
    defaultParticipants.add(String(req.user._id));

    const participants = participantIds && participantIds.length
      ? Array.from(new Set([...participantIds, ...Array.from(defaultParticipants)]))
      : Array.from(defaultParticipants);

    // Try to find an existing conversation for this credit with the same participants
    let convo = await Conversation.findOne({
      credit: creditId,
      participants: { $size: participants.length, $all: participants.map(id => mongoose.Types.ObjectId(id)) },
    });

    if (!convo) {
      convo = new Conversation({
        credit: creditId,
        participants,
        createdBy: req.user._id,
        status: 'open',
      });
      await convo.save();
    }

    return res.status(201).json({ conversation: convo });
  } catch (err) {
    next(err);
  }
};

/**
 * Send a message via REST (fallback if WebSocket not available)
 * POST /api/conversations/:id/message
 * Body: { text, type: 'positive'|'negative'|'system', meta }
 */
exports.sendMessage = async (req, res, next) => {
  try {
    const convId = req.params.id;
    const { text, type = 'system', meta = {} } = req.body;
    if (!text || !convId) return res.status(400).json({ error: 'Missing parameters' });

    const conversation = await Conversation.findById(convId);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    // Ensure user is participant or admin
    if (!conversation.participants.map(String).includes(String(req.user._id)) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not a participant' });
    }

    const message = {
      sender: req.user._id,
      senderSnapshot: {
        name: req.user.name,
        facultyID: req.user.facultyID,
      },
      type,
      content: { text, meta },
      createdAt: new Date(),
    };

    // Use method on model to append message (compressing routine inside model static method)
    await Conversation.appendMessage(conversation._id, message);

    // Optionally publish an event (push notifications) — omitted here
    return res.status(201).json({ ok: true, message });
  } catch (err) {
    next(err);
  }
};

/**
 * Get conversation messages (paginated)
 * GET /api/conversations/:id/messages?limit=50&before=<ISO timestamp or messageId>
 *
 * Returns messages in chronological order.
 */
exports.getMessages = async (req, res, next) => {
  try {
    const convId = req.params.id;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const before = req.query.before || null; // could be timestamp string or message id (we'll treat as ISO timestamp)
    const conversation = await Conversation.findById(convId).lean();
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    // Permission check
    const isParticipant = conversation.participants.map(String).includes(String(req.user._id));
    if (!isParticipant && req.user.role !== 'admin') return res.status(403).json({ error: 'Not allowed' });

    // Model helper to read paginated messages (decompresses only necessary segments)
    const messages = await Conversation.getMessagesPaginated(conversation._id, { limit, before });

    res.json({ messages });
  } catch (err) {
    next(err);
  }
};

/**
 * Simple list conversations for the user
 * GET /api/conversations
 */
exports.listConversations = async (req, res, next) => {
  try {
    const page = Math.max(0, parseInt(req.query.page || '0', 10));
    const perPage = Math.min(parseInt(req.query.perPage || '20', 10), 100);

    const filter = req.user.role === 'admin' ? {} : { participants: req.user._id };

    const [total, convos] = await Promise.all([
      Conversation.countDocuments(filter),
      Conversation.find(filter)
        .sort({ updatedAt: -1 })
        .skip(page * perPage)
        .limit(perPage)
        .select('-messageSegments') // hide big compressed blob list in listing
        .populate('credit', 'title academicYear') // optional
        .lean(),
    ]);

    res.json({ total, page, perPage, conversations: convos });
  } catch (err) {
    next(err);
  }
};

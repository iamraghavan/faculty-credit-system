// controllers/conversationController.js
const mongoose = require('mongoose');
const Conversation = require('../Models/Conversation');
const Credit = require('../Models/Credit');
const User = require('../Models/User');
// const { decompressSegment } = require('../utils/compression'); // not used here
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

    if (!mongoose.isValidObjectId(creditId)) {
      return res.status(400).json({ error: 'Invalid creditId' });
    }

    const credit = await Credit.findById(creditId);
    if (!credit) return res.status(404).json({ error: 'Credit not found' });

    // Default participants: faculty + issuedBy + current user (if not included)
    const defaultParticipants = new Set();
    if (credit.faculty) defaultParticipants.add(String(credit.faculty));
    if (credit.issuedBy) defaultParticipants.add(String(credit.issuedBy));
    if (req.user && req.user._id) defaultParticipants.add(String(req.user._id));

    // Merge provided participants (if any) with defaults, dedupe
    const mergedStrings = participantIds && participantIds.length
      ? Array.from(new Set([...participantIds.map(String), ...Array.from(defaultParticipants)]))
      : Array.from(defaultParticipants);

    // Validate participant ids
    const invalid = mergedStrings.find(id => !mongoose.isValidObjectId(id));
    if (invalid) {
      return res.status(400).json({ error: `Invalid participant id: ${invalid}` });
    }

    // Convert to ObjectId instances (use `new` to avoid the "cannot be invoked without 'new'" error)
    const participantObjectIds = mergedStrings.map(id => new mongoose.Types.ObjectId(id));

    // Try to find an existing conversation for this credit with the same participants
    // Use $all with ObjectId values and $size to ensure exact same number of participants
    let convo = await Conversation.findOne({
      credit: new mongoose.Types.ObjectId(creditId),
      participants: { $size: participantObjectIds.length, $all: participantObjectIds },
    }).exec();

    if (!convo) {
      convo = new Conversation({
        credit: new mongoose.Types.ObjectId(creditId),
        participants: participantObjectIds,
        createdBy: req.user._id ? new mongoose.Types.ObjectId(req.user._id) : undefined,
        status: 'open',
      });
      await convo.save();
      return res.status(201).json({ conversation: convo });
    }

    // Existing conversation found
    return res.status(200).json({ conversation: convo });
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

    if (!mongoose.isValidObjectId(convId)) return res.status(400).json({ error: 'Invalid conversation id' });

    const conversation = await Conversation.findById(convId);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    // Ensure user is participant or admin
    const isParticipant = conversation.participants.map(String).includes(String(req.user._id));
    if (!isParticipant && req.user.role !== 'admin') {
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

    if (!mongoose.isValidObjectId(convId)) return res.status(400).json({ error: 'Invalid conversation id' });

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


/**
 * Send a message via REST
 * POST /api/conversations/:conversationId/messages
 * Body: { text: string, type?: string, meta?: object }
 */
exports.sendMessageREST = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { text, type = 'system', meta = {} } = req.body;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversationId' });
    }

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing text' });
    }

    if (!req.user || !req.user._id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Build message object
    const message = {
      sender: req.user._id,
      senderSnapshot: {
        name: req.user.name,
        facultyID: req.user.facultyID,
        college: req.user.college,
        department: req.user.department,
      },
      type,
      content: { text, meta },
      createdAt: new Date(),
    };

    // Append to conversation
    const updatedConvo = await Conversation.appendMessage(conversationId, message);

    // Prepare response payload
    const out = {
      ...message,
      conversationId,
      totalMessages: updatedConvo.totalMessages,
      lastMessage: updatedConvo.lastMessage,
    };

    // Emit to socket clients
    const io = req.app?.locals?.io;
    if (io) {
      io.to('convo:' + conversationId).emit('message:new', out);
    }

    // Return success response
    res.status(201).json({ ok: true, message: out });
  } catch (err) {
    console.error('sendMessageREST error', err);
    next(err);
  }
};
// realtime/socketServer.js
const http = require('http');
const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const Conversation = require('../Models/Conversation');
const User = require('../Models/User');
const { verifyJWT } = require('../utils/auth'); // small helper below
const dbg = (...args) => console.log('[socket]', ...args);

// You call this with your existing HTTP server: attachSocket(server)
function attachSocket(server, opts = {}) {
  const io = socketIO(server, {
    cors: { origin: opts.corsOrigin || '*' },
    pingTimeout: 30000,
  });

  // Simple authentication middleware using JWT token in query or auth header
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Authentication error'));

      const payload = verifyJWT(token); // throws if invalid
      const user = await User.findById(payload.id).select('+password').lean();
      if (!user) return next(new Error('User not found'));
      socket.user = user;
      return next();
    } catch (err) {
      return next(new Error('Authentication error'));
    }
  });

  io.on('connection', socket => {
    dbg('connected', socket.user._id);

    // Join a conversation room
    socket.on('join', async ({ conversationId }, ack) => {
      try {
        const convo = await Conversation.findById(conversationId).select('participants').lean();
        if (!convo) return ack && ack({ error: 'Conversation not found' });
        const isParticipant = convo.participants.map(String).includes(String(socket.user._id)) || socket.user.role === 'admin';
        if (!isParticipant) return ack && ack({ error: 'Not a participant' });
        socket.join('convo:' + conversationId);
        ack && ack({ ok: true });
      } catch (err) {
        ack && ack({ error: err.message });
      }
    });

    // Handle incoming message
    socket.on('message', async (payload, ack) => {
      /*
        payload: {
          conversationId: string,
          text: string,
          type: 'positive'|'negative'|'system' (optional),
          meta: {}
        }
      */
      try {
        const { conversationId, text, type = 'system', meta = {} } = payload;
        if (!conversationId || !text) return ack && ack({ error: 'Missing params' });

        const convo = await Conversation.findById(conversationId).select('participants').lean();
        if (!convo) return ack && ack({ error: 'Conversation not found' });

        const isParticipant = convo.participants.map(String).includes(String(socket.user._id)) || socket.user.role === 'admin';
        if (!isParticipant) return ack && ack({ error: 'Not a participant' });

        // Build message object
        const message = {
          sender: socket.user._id,
          senderSnapshot: {
            name: socket.user.name,
            facultyID: socket.user.facultyID,
            college: socket.user.college,
            department: socket.user.department,
          },
          type,
          content: { text, meta },
          createdAt: new Date(),
        };

        // Append to conversation (model handles compression)
        await Conversation.appendMessage(conversationId, message);

        // Emit to room
        const out = {
          ...message,
          conversationId,
        };
        io.to('convo:' + conversationId).emit('message:new', out);

        ack && ack({ ok: true });
      } catch (err) {
        console.error('socket message error', err);
        ack && ack({ error: err.message });
      }
    });

    socket.on('leave', ({ conversationId }) => {
      socket.leave('convo:' + conversationId);
    });

    socket.on('disconnect', reason => {
      dbg('disconnect', socket.user._id, reason);
    });
  });

  return io;
}

module.exports = { attachSocket };

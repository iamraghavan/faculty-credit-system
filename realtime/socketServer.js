// realtime/socketServer.js
const socketIO = require('socket.io');
const Conversation = require('../Models/Conversation');
const User = require('../Models/User');
const { verifyJWT } = require('../utils/auth');
const dbg = (...args) => console.log('[socket]', ...args);

// In-memory mapping: userId -> Set(socketId)
// Note: for multi-instance production, replace with Redis pub/sub store.
const userSockets = new Map();

function addSocketForUser(userId, socketId) {
  const s = userSockets.get(String(userId)) || new Set();
  s.add(socketId);
  userSockets.set(String(userId), s);
}
function removeSocketForUser(userId, socketId) {
  const s = userSockets.get(String(userId));
  if (!s) return;
  s.delete(socketId);
  if (s.size === 0) userSockets.delete(String(userId));
  else userSockets.set(String(userId), s);
}
function getSocketsForUser(userId) {
  return userSockets.get(String(userId)) || new Set();
}
function isUserOnline(userId) {
  return getSocketsForUser(userId).size > 0;
}

/**
 * Attach socket.io to an existing http server
 */
function attachSocket(server, opts = {}) {
  const io = socketIO(server, {
    cors: { origin: opts.corsOrigin || '*' },
    pingTimeout: 30000,
  });

  // Authenticate sockets
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Authentication error: token missing'));
      const payload = verifyJWT(token); // should throw if invalid
      const user = await User.findById(payload.id).select('-password').lean();
      if (!user) return next(new Error('Authentication error: user not found'));
      socket.user = user;
      return next();
    } catch (err) {
      console.error('socket auth error', err);
      return next(new Error('Authentication error'));
    }
  });

  io.on('connection', socket => {
    const uid = String(socket.user._id);
    dbg('connected', uid, socket.id);

    // Register socket
    addSocketForUser(uid, socket.id);

    // Join personal user room so server can push notifications directly
    socket.join(`user:${uid}`);

    // Inform others about presence (optional)
    socket.broadcast.emit('presence:update', { userId: uid, online: true });

    // Handle joining a conversation
    socket.on('join', async ({ conversationId }, ack) => {
      try {
        if (!conversationId) return ack && ack({ error: 'conversationId required' });

        const convo = await Conversation.findById(conversationId).select('participants').lean();
        if (!convo) return ack && ack({ error: 'Conversation not found' });

        const isParticipant = convo.participants.map(String).includes(uid) || socket.user.role === 'admin';
        if (!isParticipant) return ack && ack({ error: 'Not participant' });

        socket.join('convo:' + conversationId);
        return ack && ack({ ok: true });
      } catch (err) {
        console.error('join error', err);
        return ack && ack({ error: err.message });
      }
    });

    // Handle sending message (socket path)
    socket.on('message', async (payload, ack) => {
      /*
        payload:
        {
          conversationId: string,
          text: string,
          type?: 'system'|'positive'|'negative',
          meta?: object
        }
      */
      try {
        const { conversationId, text, type = 'system', meta = {} } = payload || {};
        if (!conversationId || !text) return ack && ack({ error: 'Missing params' });

        // verify conversation and participant
        const convo = await Conversation.findById(conversationId).select('participants').lean();
        if (!convo) return ack && ack({ error: 'Conversation not found' });

        const isParticipant = convo.participants.map(String).includes(uid) || socket.user.role === 'admin';
        if (!isParticipant) return ack && ack({ error: 'Not participant' });

        // Build message object
        const message = {
          sender: socket.user._id,
          senderSnapshot: {
            name: socket.user.name,
            facultyID: socket.user.facultyID,
            college: socket.user.college,
            department: socket.user.department
          },
          type,
          content: { text, meta },
          createdAt: new Date()
        };

        // Persist message (Conversation.appendMessage handles compression)
        const updatedConvo = await Conversation.appendMessage(conversationId, message);

        // The appendMessage implementation currently returns the updated conversation.
        // To produce a message id to use for ack/delivery, we rely on message._id that appendMessage creates.
        // We'll find the last message (server-side) by checking the updatedConvo.lastMessage or by reading last segment:
        // Best-effort: emit the message object with createdAt and rely on clients to show it.
        // If you want message _id guaranteed, modify appendMessage to return the appended message id.

        // Prepare outgoing payload
        const out = {
          ...message,
          conversationId,
          totalMessages: updatedConvo.totalMessages,
          lastMessage: updatedConvo.lastMessage
        };

        // Emit to the conversation room (all connected sockets that joined)
        io.to('convo:' + conversationId).emit('message:new', out);

        // Now update unreadCounts for recipients who are not currently connected to convo room
        // recipients = convo.participants excluding sender
        const recipients = (updatedConvo.participants || convo.participants || []).map(String).filter(id => id !== String(socket.user._id));

        // Build updates: for each recipient, if user not online or not joined to convo room, increment unreadCounts
        for (const r of recipients) {
          const online = isUserOnline(r);
          // if user is connected, server will have sockets; still we should check if any socket joined convo room
          let hasSocketInRoom = false;
          if (online) {
            for (const sid of getSocketsForUser(r)) {
              const sock = io.sockets.sockets.get(sid);
              if (sock && sock.rooms && sock.rooms.has('convo:' + conversationId)) {
                hasSocketInRoom = true;
                break;
              }
            }
          }
          // If user not in convo room, increment unreadCounts
          if (!hasSocketInRoom) {
            // dynamic field update
            const field = `unreadCounts.${r}`;
            await Conversation.updateOne({ _id: conversationId }, { $inc: { [field]: 1 } }).exec();
          }
        }

        // Notify individual recipients directly (also useful for push notifications)
        for (const r of recipients) {
          io.to(`user:${r}`).emit('notification:creditMessage', {
            conversationId,
            snippet: text.slice(0, 180),
            from: { id: socket.user._id, name: socket.user.name },
            createdAt: out.createdAt
          });
        }

        // ACK to sender: include minimal info (ok + any useful metadata)
        ack && ack({ ok: true, message: out });
      } catch (err) {
        console.error('socket message error', err);
        ack && ack({ error: err.message || 'Server error' });
      }
    });

    // Client acknowledges receipt of a message (delivery)
    socket.on('message:ack', async ({ conversationId, messageCreatedAt }, ack) => {
      // messageCreatedAt: ISO string used as identifier if message id not available
      try {
        // Optionally you can persist delivery state, e.g. push messageCreatedAt into delivered map.
        // For minimal solution, emit delivered back to sender sockets:
        const convo = await Conversation.findById(conversationId).select('participants').lean();
        if (!convo) return ack && ack({ error: 'Convo not found' });

        // notify sender's sockets that recipient delivered
        const senderId = /* optional: infer from message store */ null;
        // If appended message contained 'sender' field and you returned it, you can emit to sender's user room:
        // io.to(`user:${senderId}`).emit('message:delivered', { conversationId, messageCreatedAt, deliveredBy: socket.user._id });

        ack && ack({ ok: true });
      } catch (err) {
        ack && ack({ error: err.message });
      }
    });

    // Typing indicator
    socket.on('typing', ({ conversationId, typing }) => {
      // Broadcast to convo room except current socket
      socket.to('convo:' + conversationId).emit('typing', { conversationId, user: { id: uid, name: socket.user.name }, typing: !!typing });
    });

    socket.on('leave', ({ conversationId }) => {
      socket.leave('convo:' + conversationId);
    });

    socket.on('disconnect', reason => {
      dbg('disconnect', uid, socket.id, reason);
      removeSocketForUser(uid, socket.id);
      // presence update
      socket.broadcast.emit('presence:update', { userId: uid, online: isUserOnline(uid) });
    });
  });

  return io;
}

module.exports = { attachSocket };

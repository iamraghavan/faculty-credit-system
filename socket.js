const { Server } = require('socket.io');
let io;

function initSocket(server) {
  io = new Server(server, { cors: { origin: '*' } });
  io.on('connection', socket => {
    console.log('Socket connected:', socket.id);
    socket.on('disconnect', () => console.log('Socket disconnected:', socket.id));
  });
}

module.exports = { initSocket, emit: (...args) => io?.emit(...args) || null };

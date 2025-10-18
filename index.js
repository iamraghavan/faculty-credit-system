// index.js
require('dotenv').config();
const http = require('http');
const app = require('./server');        // your Express app
const connectDB = require('./config/db');
const { startSelfPinger } = require('./utils/selfPinger');
const { attachSocket } = require('./realtime/socketServer'); // make sure path is correct

const PORT = process.env.PORT || 8000;

(async function start() {
  try {
    await connectDB();
    // create raw http server from express app
    const server = http.createServer(app);

    // attach socket.io to the http server
    const io = attachSocket(server, { corsOrigin: process.env.CORS_ORIGIN || '*' });
    // store io for later use (ex: emitting from REST controllers or shutdown)
    app.locals.io = io;

    // start listening
    server.listen(PORT, () => {
      console.log(`✅ Server started on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);

      // ---- SELF-PINGER START ----
      if (process.env.ENABLE_SELF_PINGER === 'true') {
        const pinger = startSelfPinger(app, {
          intervalMs: parseInt(process.env.SELF_PINGER_INTERVAL_MS || '240000', 10),
          endpoints: (process.env.SELF_PINGER_ENDPOINTS || '/api/health,/').split(',').map(s => s.trim()),
          jitter: true
        });
        app.locals._selfPinger = pinger; // store reference to stop later if needed
        console.log('🚀 Self-pinger started (keeping host awake)');
      } else {
        console.log('🟡 Self-pinger disabled (ENABLE_SELF_PINGER=false)');
      }
      // ---- SELF-PINGER END ----
    });

    // graceful shutdown: close http server and socket.io, stop pinger
    const gracefulShutdown = async () => {
      console.log('🛑 Shutting down gracefully...');
      try {
        if (app.locals._selfPinger) {
          try { app.locals._selfPinger.stop(); } catch(e) { /* ignore */ }
        }
        // stop accepting new connections
        server.close(() => {
          console.log('✅ HTTP server closed');
        });

        // close socket.io (disconnects clients)
        if (io && io.close) {
          io.close();
          console.log('✅ Socket.IO closed');
        }

        // optional: give a few seconds for connections to drain
        setTimeout(() => process.exit(0), 2000);
      } catch (err) {
        console.error('Error during shutdown', err);
        process.exit(1);
      }
    };

    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);

  } catch (err) {
    console.error('❌ Failed to start server due to:', err);
    process.exit(1);
  }
})();

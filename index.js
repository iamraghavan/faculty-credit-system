// index.js - entry point
require('dotenv').config();
const app = require('./server');
const connectDB = require('./config/db');
const { startSelfPinger } = require('./utils/selfPinger'); // <-- add this line

const PORT = process.env.PORT || 8000;

// Connect to MongoDB first
connectDB()
  .then(() => {
    const server = app.listen(PORT, () => {
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

    // Handle graceful shutdown (optional)
    process.on('SIGINT', () => {
      console.log('🛑 Shutting down gracefully...');
      if (app.locals._selfPinger) app.locals._selfPinger.stop();
      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
    });
  })
  .catch((err) => {
    console.error('❌ Failed to start server due to DB error:', err);
    process.exit(1);
  });

// index.js
require('dotenv').config();
const http = require('http');
const app = require('./server'); // your Express app
const connectDB = require('./config/db');
const { attachSocket } = require('./realtime/socketServer'); // make sure path is correct

const PORT = process.env.PORT || 81;

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
    server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on http://172.16.20.129:${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

    // graceful shutdown: close http server and socket.io
    const gracefulShutdown = async () => {
      console.log('Shutting down gracefully...');
      try {
        // stop accepting new connections
        server.close(() => {
          console.log('HTTP server closed');
        });

        // close socket.io (disconnects clients)
        if (io && io.close) {
          io.close();
          console.log('Socket.IO closed');
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
    console.error('Failed to start server due to:', err);
    process.exit(1);
  }
})();

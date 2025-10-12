// index.js - entry point
require('dotenv').config();
const app = require('./server');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 8000;

// Connect to MongoDB first
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server started on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server due to DB error:', err);
    process.exit(1);
  });

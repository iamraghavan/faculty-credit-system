// config/db.js - MongoDB connection
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      throw new Error('MONGO_URI is not set in environment variables');
    }

    // Connect to MongoDB
    await mongoose.connect(uri);

    console.log('✅ Connected to MongoDB:', uri.split('@')[1].split('/')[1]);

  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error.message);
    process.exit(1); // Exit process with failure
  }
};

module.exports = connectDB;

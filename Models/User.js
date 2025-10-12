// Models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    facultyID: { type: String, required: true, unique: true }, // EGSP/EC/12345
    college: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['faculty', 'admin'], default: 'faculty' },
    apiKey: { type: String, unique: true, required: true },
    currentCredit: { type: Number, default: 0 },
    creditsByYear: {
      // store credits per academic year e.g. { "2024-2025": 10, "2023-2024": 5 }
      type: Map,
      of: Number,
      default: {}
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Add indexes for faster queries if needed
userSchema.index({ facultyID: 1 });

module.exports = mongoose.model('User', userSchema);

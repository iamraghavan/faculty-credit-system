const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    // 👇 Added prefix field
    prefix: {
      type: String,
      enum: ['Mr.', 'Ms.', 'Mrs.', 'Dr.'],
      default: 'Mr.'
    },

    facultyID: { type: String, required: true, unique: true }, // EGSP/EC/12345
    college: { type: String, required: true },
    department: { type: String },

    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, select: false },

    // 👇 Keeps the user level (admin/faculty)
    role: { type: String, enum: ['faculty', 'admin'], default: 'faculty' },

    // 👇 New fields for teaching category & designation
    roleCategory: {
      type: String,
      enum: ['Teaching', 'Non-Teaching'],
      required: true
    },
    designation: { type: String, required: true }, // e.g., "Asst. Prof", "Lab Assistant"

    apiKey: { type: String, unique: true, required: true },
    currentCredit: { type: Number, default: 0 },
    creditsByYear: { type: Map, of: Number, default: {} },
    isActive: { type: Boolean, default: true },
    phone: { type: String },
    profileImage: { type: String },
  },
  { timestamps: true }
);

// Indexes for performance
userSchema.index({ department: 1 });
userSchema.index({ college: 1 });
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });

module.exports = mongoose.model('User', userSchema);

// Models/Credit.js
const mongoose = require('mongoose');

const creditSchema = new mongoose.Schema(
  {
    faculty: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    facultySnapshot: { // quick snapshot of user's important info to prevent accidental inconsistencies later
      facultyID: String,
      name: String,
      college: String,
    },
    type: { type: String, enum: ['positive', 'negative'], required: true },
    title: { type: String, required: true },
    points: { type: Number, required: true }, // can be negative in DB if type == 'negative'
    proofUrl: { type: String }, // cdn or raw url (github/jsdelivr or other)
    proofMeta: { originalName: String, size: Number, mimeType: String },
    academicYear: { type: String, required: true }, // e.g., "2024-2025"
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // who created the credit (faculty or admin)
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'appealed'], default: 'approved' },
    appeal: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reason: String,
      createdAt: Date,
      status: { type: String, enum: ['pending', 'accepted', 'rejected'] }
    },
    notes: String,
  },
  { timestamps: true }
);

creditSchema.index({ faculty: 1, academicYear: 1 });

module.exports = mongoose.model('Credit', creditSchema);

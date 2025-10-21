const mongoose = require('mongoose');

const creditSchema = new mongoose.Schema(
  {
    faculty: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    facultySnapshot: {
      facultyID: String,
      name: String,
      college: String,
      department: String,
    },
    type: { type: String, enum: ['positive', 'negative'], required: true },
    creditTitle: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditTitle' },

    title: { type: String, required: true },
    points: { type: Number, required: true },
    categories: { type: [String], default: [] },

    proofUrl: String,
    proofMeta: {
      originalName: String,
      size: Number,
      mimeType: String,
    },
    academicYear: { type: String, required: true },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'appealed'],
      default: 'approved',
    },

    appeal: {
      by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reason: String,
      proofUrl: String,
      proofMeta: {
        originalName: String,
        size: Number,
        mimeType: String,
      },
      createdAt: Date,
      status: { type: String, enum: ['pending', 'accepted', 'rejected'] },
    },

    notes: String,
  },
  { timestamps: true }
);

creditSchema.index({ faculty: 1, academicYear: 1 });
creditSchema.index({ type: 1 });
creditSchema.index({ 'appeal.status': 1 });

module.exports = mongoose.model('Credit', creditSchema);

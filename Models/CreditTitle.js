// Models/CreditTitle.js
const mongoose = require('mongoose');

const creditTitleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, unique: true },
    points: { type: Number, required: true }, // points value
    type: { type: String, enum: ['positive', 'negative'], default: 'positive' },
    categories: { type: [String], default: [] }, // e.g. ['research','publication']
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // admin id
    description: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Add indexes to speed lookups by type / categories
creditTitleSchema.index({ type: 1 });
creditTitleSchema.index({ categories: 1 });

module.exports = mongoose.model('CreditTitle', creditTitleSchema);

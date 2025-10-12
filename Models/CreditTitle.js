const mongoose = require('mongoose');

const creditTitleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, unique: true },
    points: { type: Number, required: true }, // points value
    type: { type: String, enum: ['positive', 'negative'], default: 'positive' }, // optional
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // admin id
    description: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CreditTitle', creditTitleSchema);

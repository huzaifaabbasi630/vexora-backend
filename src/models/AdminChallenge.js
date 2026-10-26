const mongoose = require('mongoose');

const adminChallengeSchema = new mongoose.Schema({
  ownerEmail: { type: String, required: true, index: true },
  challengeId: { type: String, required: true, unique: true },
  otpHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  resendCount: { type: Number, default: 0 },
  lastResentAt: { type: Date, default: null },
  used: { type: Boolean, default: false },
  status: { type: String, enum: ['pending', 'used', 'expired'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
});

adminChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AdminChallenge', adminChallengeSchema);

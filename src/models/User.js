// src/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String },
  address: { type: String },
  role: { type: String, enum: ['customer', 'owner'], default: 'customer' },
  isOwner: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  hasPlacedOrder: { type: Boolean, default: false },
  expiresAt: { type: Date, default: Date.now, index: { expires: 0 } }, // TTL, expire after 0 seconds from expiresAt
}, { timestamps: true });

userSchema.index({ role: 1, isOwner: 1, createdAt: -1 });

module.exports = mongoose.model('User', userSchema);

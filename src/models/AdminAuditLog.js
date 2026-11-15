const mongoose = require('mongoose');

const adminAuditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorEmail: { type: String, required: true },
  action: { type: String, required: true },
  targetType: { type: String, default: 'system' },
  targetId: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  ipAddress: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

adminAuditLogSchema.index({ createdAt: -1, _id: -1 });

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);

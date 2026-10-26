const mongoose = require('mongoose');

const contactMessageSchema = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 100 },
  email: { type: String, required: true, maxlength: 254 },
  subject: { type: String, required: true, maxlength: 80 },
  orderNumber: { type: String, default: '', maxlength: 80 },
  message: { type: String, required: true, maxlength: 3000 },
  status: { type: String, enum: ['New', 'In Progress', 'Resolved', 'Archived'], default: 'New' },
  createdAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

contactMessageSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ContactMessage', contactMessageSchema);

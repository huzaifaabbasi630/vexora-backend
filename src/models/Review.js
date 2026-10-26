const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    index: true,
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  customerName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  title: {
    type: String,
    trim: true,
    maxlength: 200,
  },
  comment: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000,
  },
  verifiedPurchase: {
    type: Boolean,
    default: false,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true,
  },
  helpful: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

// Ensure one review per customer per product
reviewSchema.index({ productId: 1, customerId: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);

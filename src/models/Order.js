// src/models/Order.js
const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  productSlug: { type: String, default: '' },
  sku: { type: String, default: '' },
  name:  { type: String, required: true },
  qty:   { type: Number, required: true, min: 1 },
  price: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 },
  selectedSize:  { type: String, default: '' },
  selectedColor: { type: String, default: '' },
}, { _id: false });

const confirmationNotificationsSchema = new mongoose.Schema({
  emailSentAt: { type: Date, default: null },
  customerWhatsAppSentAt: { type: Date, default: null },
  ownerWhatsAppSentAt: { type: Date, default: null },
}, { _id: false });

const statusNotificationsSchema = new mongoose.Schema({
  dispatchedEmailSentAt: { type: Date, default: null },
  dispatchedWhatsAppSentAt: { type: Date, default: null },
  onTheWayEmailSentAt: { type: Date, default: null },
  onTheWayWhatsAppSentAt: { type: Date, default: null },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  // Customer details collected at checkout (no login required)
  customerInfo: {
    name:    { type: String, required: true },
    phone:   { type: String, required: true },
    address: { type: String, required: true },
    email:   { type: String, required: true },
  },

  cartItems: { type: [cartItemSchema], required: true },
  total:     { type: Number, required: true },

  status: {
    type: String,
    enum: ['Pending Confirmation', 'Confirming', 'Confirmed', 'Dispatched', 'On The Way', 'Delivered'],
    default: 'Pending Confirmation',
  },

  // Set when customer clicks the confirmation link in the email
  confirmedAt: { type: Date, default: null },
  confirmationNotifications: {
    type: confirmationNotificationsSchema,
    default: () => ({}),
  },
  statusNotifications: {
    type: statusNotificationsSchema,
    default: () => ({}),
  },

  // TTL: MongoDB auto-deletes the document when this date is reached.
  // Unconfirmed orders expire after 1 day; confirmed orders are kept for 30 days.
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day from now
    index: { expireAfterSeconds: 0 },
  },
}, { timestamps: true });

orderSchema.index({ createdAt: -1, _id: -1 });
orderSchema.index({ createdAt: -1, status: 1 });

module.exports = mongoose.model('Order', orderSchema);

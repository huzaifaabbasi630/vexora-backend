const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
  url: { type: String, required: true, trim: true, maxlength: 2048 },
  alt: { type: String, default: '', trim: true, maxlength: 200 },
}, { _id: false });

const variantSchema = new mongoose.Schema({
  sku: { type: String, trim: true, uppercase: true, maxlength: 80, default: '' },
  size: { type: String, trim: true, maxlength: 40, default: '' },
  color: { type: String, trim: true, maxlength: 80, default: '' },
  stock: { type: Number, min: 0, validate: Number.isInteger, default: 0 },
}, { _id: false });

const colorImageSchema = new mongoose.Schema({
  color: { type: String, required: true, trim: true, maxlength: 80 },
  imageUrl: { type: String, required: true, trim: true, maxlength: 2048 },
}, { _id: false });

const productSchema = new mongoose.Schema({
  legacyId: { type: String, trim: true, maxlength: 120, unique: true, sparse: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
  slug: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true, maxlength: 180 },
  description: { type: String, default: '', trim: true, maxlength: 10000 },
  shortDescription: { type: String, default: '', trim: true, maxlength: 500 },
  sku: { type: String, trim: true, uppercase: true, maxlength: 80, default: '' },
  category: { type: String, required: true, trim: true, maxlength: 100 },
  categories: { type: [{ type: String, trim: true, maxlength: 100 }], default: [] },
  tags: { type: [String], default: [] },
  regularPrice: { type: Number, required: true, min: 0 },
  salePrice: { type: Number, min: 0, default: null },
  images: { type: [imageSchema], default: [] },
  sizes: { type: [String], default: [] },
  colors: { type: [String], default: [] },
  colorImages: { type: [colorImageSchema], default: [] },
  variants: { type: [variantSchema], default: [] },
  stock: { type: Number, min: 0, validate: Number.isInteger, default: 0 },
  trackInventory: { type: Boolean, default: true },
  featured: { type: Boolean, default: false },
  bestseller: { type: Boolean, default: false },
  newArrival: { type: Boolean, default: false },
  categoryFeatured: { type: Boolean, default: false },
  viewCount: { type: Number, min: 0, default: 0 },
  rating: { type: Number, min: 0, max: 5, default: null },
  reviewCount: { type: Number, min: 0, validate: (value) => value == null || Number.isInteger(value), default: null },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
  seoTitle: { type: String, default: '', trim: true, maxlength: 180 },
  seoDescription: { type: String, default: '', trim: true, maxlength: 320 },
}, { timestamps: true, versionKey: false });

productSchema.path('salePrice').validate(function validateSalePrice(value) {
  return value == null || value < this.regularPrice;
}, 'Sale price must be less than regular price.');

productSchema.index({ status: 1, category: 1, createdAt: -1 });
productSchema.index({ status: 1, categories: 1, createdAt: -1 });
productSchema.index({ status: 1, featured: 1, newArrival: 1 });
productSchema.index({ sku: 1 }, { unique: true, partialFilterExpression: { sku: { $type: 'string', $gt: '' } } });

module.exports = mongoose.model('Product', productSchema);

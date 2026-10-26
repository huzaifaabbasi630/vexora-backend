const mongoose = require('mongoose');

const cmsVersionSchema = new mongoose.Schema({
  content: { type: mongoose.Schema.Types.Mixed, required: true },
  savedAt: { type: Date, default: Date.now },
  published: { type: Boolean, default: false },
}, { _id: false });

const cmsPageSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
  draft: { type: mongoose.Schema.Types.Mixed, default: {} },
  publishedContent: { type: mongoose.Schema.Types.Mixed, default: null },
  versions: { type: [cmsVersionSchema], default: [] },
  updatedBy: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('CmsPage', cmsPageSchema);

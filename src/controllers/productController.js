const mongoose = require('mongoose');
const Product = require('../models/Product');
const AdminAuditLog = require('../models/AdminAuditLog');

const slugify = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 180);

const cleanString = (value, maxLength) => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
const addOrFilter = (query, clauses) => {
  if (query.$or) {
    query.$and = [...(query.$and || []), { $or: query.$or }, { $or: clauses }];
    delete query.$or;
    return;
  }
  query.$or = clauses;
};
const validImages = (images) => Array.isArray(images)
  && images.length <= 20
  && images.every((image) => image && typeof image.url === 'string'
    && image.url.length <= 2048
    && /^(https?:\/\/|\/)/i.test(image.url)
    && (!image.alt || typeof image.alt === 'string'));

function toPublicProduct(product) {
  const row = product.toObject ? product.toObject() : product;
  const mainImage = row.images?.[0]?.url || '';
  return {
    ...row,
    id: row.legacyId || row.slug,
    price: row.salePrice ?? row.regularPrice,
    oldPrice: row.salePrice != null ? row.regularPrice : null,
    image: mainImage,
    gallery: (row.images || []).map((image) => image.url),
    subtitle: row.shortDescription || '',
    colors: row.colors || [],
    sizes: row.sizes || [],
    reviews: row.reviewCount,
    colorImages: (row.colorImages || []).map(ci => ({ color: ci.color, imageUrl: ci.imageUrl })),
  };
}

function parseProductInput(body, existing = null) {
  const fields = {};
  const allowedStringFields = {
    name: 160,
    slug: 180,
    description: 10000,
    shortDescription: 500,
    sku: 80,
    category: 100,
    seoTitle: 180,
    seoDescription: 320,
    subtitle: 120,
  };

  for (const [key, max] of Object.entries(allowedStringFields)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) fields[key] = cleanString(body[key], max);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'categories')) {
    if (!Array.isArray(body.categories) || body.categories.length > 50
      || body.categories.some((value) => typeof value !== 'string' || value.length > 100)) {
      throw new Error('Categories must be an array of at most 50 strings, each up to 100 characters.');
    }
    fields.categories = [...new Set(body.categories.map((value) => cleanString(value, 100)).filter(Boolean))];
    if (!fields.category) {
      fields.category = fields.categories.includes(existing?.category)
        ? existing.category
        : fields.categories[0] || '';
    }
    if (fields.category && !fields.categories.includes(fields.category)) {
      fields.categories.unshift(fields.category);
    }
  } else if (Object.prototype.hasOwnProperty.call(body, 'category')) {
    fields.categories = fields.category ? [fields.category] : [];
  }
  if (Object.prototype.hasOwnProperty.call(body, 'slug')) {
    fields.slug = slugify(body.slug);
  }
  if (!fields.slug && Object.prototype.hasOwnProperty.call(body, 'name')) {
    fields.slug = slugify(fields.name);
  }

  for (const key of ['regularPrice', 'salePrice', 'stock']) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    if (body[key] === '' && key === 'salePrice') {
      fields.salePrice = null;
      continue;
    }
    const number = Number(body[key]);
    if (!Number.isFinite(number) || number < 0 || (key === 'stock' && !Number.isInteger(number))) {
      throw new Error(`${key} must be a valid non-negative ${key === 'stock' ? 'integer' : 'number'}.`);
    }
    fields[key] = number;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'rating')) {
    const rating = body.rating === '' ? null : Number(body.rating);
    if (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 5)) throw new Error('Rating must be between 0 and 5.');
    fields.rating = rating;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'reviewCount')) {
    const reviewCount = body.reviewCount === '' ? null : Number(body.reviewCount);
    if (reviewCount !== null && (!Number.isInteger(reviewCount) || reviewCount < 0)) throw new Error('Review count must be a non-negative integer.');
    fields.reviewCount = reviewCount;
  }

  for (const key of ['featured', 'bestseller', 'newArrival', 'trackInventory', 'categoryFeatured']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      if (typeof body[key] !== 'boolean') throw new Error(`${key} must be true or false.`);
      fields[key] = body[key];
    }
  }

  for (const key of ['sizes', 'colors', 'tags']) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    if (!Array.isArray(body[key]) || body[key].length > 100 || body[key].some((value) => typeof value !== 'string' || value.length > 100)) {
      throw new Error(`${key} must be an array of strings.`);
    }
    fields[key] = [...new Set(body[key].map((value) => value.trim()).filter(Boolean))];
  }

  if (Object.prototype.hasOwnProperty.call(body, 'images')) {
    if (!validImages(body.images)) throw new Error('Images must contain valid HTTP(S) URLs or site-relative asset paths.');
    fields.images = body.images.map(({ url, alt = '' }) => ({ url: cleanString(url, 2048), alt: cleanString(alt, 200) }));
  }

  if (Object.prototype.hasOwnProperty.call(body, 'colorImages')) {
    if (!Array.isArray(body.colorImages) || body.colorImages.length > 50) {
      throw new Error('Color images must be an array with at most 50 entries.');
    }
    fields.colorImages = body.colorImages.map((ci) => {
      if (!ci || typeof ci !== 'object' || Array.isArray(ci)) {
        throw new Error('Each color image must be an object with color and imageUrl.');
      }
      const color = cleanString(ci.color, 80);
      const imageUrl = cleanString(ci.imageUrl, 2048);
      if (!color || !imageUrl) {
        throw new Error('Color image entries must have both color and imageUrl.');
      }
      if (!/^(https?:\/\/|\/)/i.test(imageUrl)) {
        throw new Error('Color image URLs must be valid HTTP(S) URLs or site-relative paths.');
      }
      return { color, imageUrl };
    });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'variants')) {
    if (!Array.isArray(body.variants) || body.variants.length > 300) throw new Error('Variants must be an array with at most 300 entries.');
    const seen = new Set();
    fields.variants = body.variants.map((variant) => {
      if (!variant || typeof variant !== 'object' || Array.isArray(variant)) throw new Error('Each variant must be an object.');
      const size = cleanString(variant.size, 40);
      const color = cleanString(variant.color, 80);
      const sku = cleanString(variant.sku, 80).toUpperCase();
      const stock = Number(variant.stock);
      if (!Number.isInteger(stock) || stock < 0) throw new Error('Variant stock must be a non-negative integer.');
      const key = `${size.toLowerCase()}|${color.toLowerCase()}`;
      if (seen.has(key)) throw new Error('Product variants must have unique size/color combinations.');
      seen.add(key);
      return { sku, size, color, stock };
    });
  }

  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    if (!['draft', 'published', 'archived'].includes(body.status)) throw new Error('Status must be draft, published, or archived.');
    fields.status = body.status;
  }

  const merged = { ...(existing?.toObject ? existing.toObject() : existing || {}), ...fields };
  if (!merged.name || merged.name.length < 2) throw new Error('Product name must be at least 2 characters.');
  if (!merged.slug) throw new Error('A valid product slug is required.');
  if (!merged.category) throw new Error('Product category is required.');
  if (merged.regularPrice == null || !Number.isFinite(Number(merged.regularPrice)) || Number(merged.regularPrice) < 0) {
    throw new Error('Regular price is required and must be non-negative.');
  }
  if (merged.salePrice != null && Number(merged.salePrice) >= Number(merged.regularPrice)) {
    throw new Error('Sale price must be less than regular price.');
  }
  return fields;
}

async function logProductAction(req, action, product) {
  await AdminAuditLog.create({
    actorId: req.owner._id,
    actorEmail: req.owner.email,
    action,
    targetType: 'product',
    targetId: String(product._id),
    metadata: { slug: product.slug, status: product.status },
    ipAddress: req.ip || req.socket?.remoteAddress || '',
  });
}

exports.listPublicProducts = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 100));
  const query = { status: 'published' };
  if (req.query.category) {
    const category = cleanString(req.query.category, 100);
    addOrFilter(query, [{ category }, { categories: category }]);
  }
  if (req.query.featured === 'true') query.featured = true;
  if (req.query.newArrival === 'true') query.newArrival = true;
  if (req.query.search) {
    const search = cleanString(req.query.search, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchClauses = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } },
      { categories: { $regex: search, $options: 'i' } },
      { tags: { $regex: search, $options: 'i' } },
    ];
    addOrFilter(query, searchClauses);
  }
  const sorters = {
    newest: { createdAt: -1 },
    name: { name: 1 },
    price_asc: { salePrice: 1, regularPrice: 1 },
    price_desc: { salePrice: -1, regularPrice: -1 },
  };
  const sort = sorters[req.query.sort] || { featured: -1, createdAt: -1 };
  const [total, rows] = await Promise.all([
    Product.countDocuments(query),
    Product.find(query).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  return res.json({ page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), rows: rows.map(toPublicProduct) });
};

exports.getPublicProduct = async (req, res) => {
  const key = cleanString(req.params.slug, 180).toLowerCase();
  const product = await Product.findOne({
    status: 'published',
    $or: [{ slug: key }, { legacyId: key }],
  }).lean();
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  return res.json({ product: toPublicProduct(product) });
};

exports.listAdminProducts = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const query = {};
  if (['draft', 'published', 'archived'].includes(req.query.status)) query.status = req.query.status;
  if (req.query.category) {
    const category = cleanString(req.query.category, 100);
    addOrFilter(query, [{ category }, { categories: category }]);
  }
  if (req.query.featured === 'true' || req.query.featured === 'false') query.featured = req.query.featured === 'true';
  if (req.query.search) {
    const search = cleanString(req.query.search, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchClauses = [
      { name: { $regex: search, $options: 'i' } },
      { sku: { $regex: search, $options: 'i' } },
      { slug: { $regex: search, $options: 'i' } },
    ];
    addOrFilter(query, searchClauses);
  }
  const sorters = {
    name: { name: 1 },
    newest: { createdAt: -1 },
    price_asc: { regularPrice: 1 },
    price_desc: { regularPrice: -1 },
    stock: { stock: 1 },
  };
  const sort = sorters[req.query.sort] || { createdAt: -1 };
  const [total, rows, primaryCategories, assignedCategories] = await Promise.all([
    Product.countDocuments(query),
    Product.find(query).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Product.distinct('category'),
    Product.distinct('categories'),
  ]);
  const categories = [...new Set([...primaryCategories, ...assignedCategories])].filter(Boolean).sort((a, b) => a.localeCompare(b));
  return res.json({ page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), categories: categories.sort(), rows });
};

exports.getAdminProduct = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId)) return res.status(400).json({ message: 'Invalid product ID.' });
  const product = await Product.findById(req.params.productId).lean();
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  return res.json({ product });
};

exports.createAdminProduct = async (req, res) => {
  let fields;
  try {
    fields = parseProductInput(req.body || {});
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  if (fields.status === 'published' && !fields.images?.length) {
    return res.status(400).json({ message: 'Add at least one product image before publishing.' });
  }
  try {
    const product = await Product.create(fields);
    await logProductAction(req, 'product_created', product);
    return res.status(201).json({ message: 'Product created.', product });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'A product with this slug, legacy identifier, or SKU already exists.' });
    throw error;
  }
};

exports.updateAdminProduct = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId)) return res.status(400).json({ message: 'Invalid product ID.' });
  const product = await Product.findById(req.params.productId);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  let fields;
  try {
    fields = parseProductInput(req.body || {}, product);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  if (fields.status === 'published' && !(fields.images || product.images).length) {
    return res.status(400).json({ message: 'Add at least one product image before publishing.' });
  }
  Object.assign(product, fields);
  try {
    await product.save();
    await logProductAction(req, 'product_updated', product);
    return res.json({ message: 'Product updated.', product });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'A product with this slug or SKU already exists.' });
    throw error;
  }
};

exports.archiveAdminProduct = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId)) return res.status(400).json({ message: 'Invalid product ID.' });
  const product = await Product.findByIdAndUpdate(req.params.productId, { $set: { status: 'archived' } }, { new: true });
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  await logProductAction(req, 'product_archived', product);
  return res.json({ message: 'Product archived. Historical order snapshots remain unchanged.', product });
};

exports.setProductStatus = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId)) return res.status(400).json({ message: 'Invalid product ID.' });
  const { status } = req.body || {};
  if (!['draft', 'published', 'archived'].includes(status)) return res.status(400).json({ message: 'Status must be draft, published, or archived.' });
  const product = await Product.findById(req.params.productId);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  if (status === 'published' && product.images.length === 0) return res.status(400).json({ message: 'Add at least one product image before publishing.' });
  product.status = status;
  await product.save();
  await logProductAction(req, `product_${status}`, product);
  return res.json({ message: `Product ${status}.`, product });
};

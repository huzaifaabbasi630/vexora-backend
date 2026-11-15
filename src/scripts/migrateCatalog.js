require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });
const path = require('path');
const { pathToFileURL } = require('url');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Product = require('../models/Product');

const slugify = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 180);

async function migrateCatalog() {
  const apply = process.argv.includes('--apply');
  const modulePath = pathToFileURL(path.resolve(__dirname, '../../../frontend/src/data/catalog.js')).href;
  const { products } = await import(modulePath);
  if (!Array.isArray(products)) throw new Error('Frontend catalog does not export a product list.');

  await connectDB();
  let insertCount = 0;
  let existingCount = 0;
  let rejectedCount = 0;
  const operations = [];

  for (const source of products) {
    const legacyId = String(source.id || '').trim();
    const name = String(source.name || '').trim();
    const slug = slugify(legacyId || name);
    const regularPrice = Number(source.oldPrice > source.price ? source.oldPrice : source.price);
    const salePrice = source.oldPrice > source.price ? Number(source.price) : null;
    const gallery = Array.isArray(source.gallery) && source.gallery.length
      ? source.gallery
      : source.image ? [source.image] : [];
    if (!legacyId || name.length < 2 || !slug || !Number.isFinite(regularPrice) || regularPrice < 0
      || (salePrice !== null && (!Number.isFinite(salePrice) || salePrice < 0))
      || gallery.some((url) => typeof url !== 'string' || !/^(https?:\/\/|\/)/i.test(url))) {
      rejectedCount += 1;
      console.warn(`Rejected catalog row: ${legacyId || '(missing identifier)'}`);
      continue;
    }

    const existing = await Product.findOne({ $or: [{ legacyId }, { slug }] }).select('_id').lean();
    if (existing) {
      existingCount += 1;
      continue;
    }
    insertCount += 1;
    const document = {
      legacyId,
      name: name.slice(0, 160),
      slug,
      description: String(source.description || '').slice(0, 10000),
      shortDescription: String(source.subtitle || '').slice(0, 500),
      category: String(source.category || 'Uncategorized').slice(0, 100),
      regularPrice,
      salePrice,
      images: gallery.map((url, index) => ({ url, alt: index === 0 ? name : `${name} image ${index + 1}` })),
      sizes: Array.isArray(source.sizes) ? source.sizes.filter((item) => typeof item === 'string') : [],
      colors: Array.isArray(source.colors) ? source.colors.filter((item) => typeof item === 'string') : [],
      rating: Number.isFinite(Number(source.rating)) ? Number(source.rating) : null,
      reviewCount: Number.isInteger(Number(source.reviews)) ? Number(source.reviews) : null,
      stock: 0,
      trackInventory: false,
      status: 'published',
    };
    operations.push({
      updateOne: {
        filter: { legacyId },
        update: { $setOnInsert: document },
        upsert: true,
      },
    });
  }

  console.log(`${apply ? 'Migration preview' : 'DRY RUN'}: ${insertCount} insert, ${existingCount} existing, ${rejectedCount} rejected.`);
  if (apply && operations.length) {
    const result = await Product.bulkWrite(operations, { ordered: false });
    console.log(`Applied: ${result.upsertedCount} inserted; existing catalog records were not modified.`);
  } else if (!apply) {
    console.log('No database changes made. Run npm run migrate-catalog -- --apply to insert missing products.');
  }
}

migrateCatalog()
  .catch((error) => {
    console.error(`Catalog migration failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });

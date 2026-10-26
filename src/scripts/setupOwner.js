require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');

async function setupOwner() {
  const email = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
  const password = process.env.OWNER_INITIAL_PASSWORD || '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Set a valid OWNER_EMAIL in backend/.env before running owner setup.');
  }
  if (password.length < 8) {
    throw new Error('Set OWNER_INITIAL_PASSWORD to at least 8 characters before running owner setup.');
  }

  await connectDB();
  const existing = await User.findOne({ email });
  const owner = existing || new User({ email });
  owner.name = existing?.name || 'VEXORA Owner';
  owner.password = await bcrypt.hash(password, 12);
  owner.role = 'owner';
  owner.isOwner = true;
  owner.isActive = true;
  owner.expiresAt = new Date('9999-12-31T23:59:59.999Z');
  if (!owner.phone) owner.phone = '';
  if (!owner.address) owner.address = 'System owner';
  await owner.save();

  console.log(`Owner account is ready for ${email}. Password was stored as a bcrypt hash.`);
}

setupOwner()
  .catch((error) => {
    console.error(`Owner setup failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });

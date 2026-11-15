const mongoose = require('mongoose');

const connectDB = async () => {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error('Missing MongoDB URI. Set MONGODB_URI in backend/.env.');
  }

  if (mongoUri.startsWith('"') || mongoUri.startsWith("'")) {
    throw new Error('Invalid MongoDB URI. Remove surrounding quotes and keep the full URI on one line.');
  }

  if (!/^mongodb(?:\+srv)?:\/\//i.test(mongoUri)) {
    throw new Error('Invalid MONGODB_URI. It must start with mongodb:// or mongodb+srv://.');
  }

  await mongoose.connect(mongoUri);
  console.log('MongoDB connected');
};

module.exports = connectDB;

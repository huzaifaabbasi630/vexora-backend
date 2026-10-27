// src/index.js
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const { allowedOrigins, normalizeOrigin } = require('./config/allowedOrigins');
const { getWhatsAppConfigStatus } = require('./utils/whatsapp');

// Routes
const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/order');
const webhookRoutes = require('./routes/webhook');
const contactRoutes = require('./routes/contact');
const adminRoutes = require('./routes/admin');
const productRoutes = require('./routes/products');
const reviewRoutes = require('./routes/reviews');
const { getPublishedCmsPage, ensureOwnerExists } = require('./controllers/adminController');

const app = express();

console.log('WhatsApp configuration status:', getWhatsAppConfigStatus());

connectDB()
  .then(() => ensureOwnerExists())
  .catch((error) => console.error('Database initialization failed:', error));

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(normalizeOrigin(origin))) return callback(null, true);
    const error = new Error('Origin is not allowed by CORS.');
    error.status = 403;
    return callback(error);
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log webhook arrival without writing customer message contents to runtime logs.
app.use('/webhook', (req, _res, next) => {
  console.log('📩 WhatsApp webhook HTTP request received:', req.method, req.path);
  next();
});

// Public API routes
app.use('/api/auth', authRoutes);
app.use('/api/contact', contactRoutes);
app.get('/api/content/:slug', (req, res, next) => Promise.resolve(getPublishedCmsPage(req, res)).catch(next));
app.use('/api/admin', adminRoutes);
app.use('/api/products', productRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api', orderRoutes);
app.use('/webhook', webhookRoutes);

// Simple health check
app.get('/', (_req, res) => res.send('E‑commerce backend is up'));

app.use((error, _req, res, next) => {
  console.error(`Request failed (${error.code || error.name || 'SERVER_ERROR'}).`);
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body must contain valid JSON.' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body is too large.' });
  }
  const statusCode = Number(error.statusCode || error.status);
  const status = statusCode >= 400 && statusCode < 600 ? statusCode : 500;
  const message = status === 403 && error.message
    ? error.message
    : 'The request could not be completed.';
  return res.status(status).json({ message });
});

const PORT = process.env.PORT || 5000;

// Local development ke liye app.listen (Vercel par yeh execute nahi hoga)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
}

module.exports = app;
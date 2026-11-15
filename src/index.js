// src/index.js
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

// Routes
const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/order');
const webhookRoutes = require('./routes/webhook');
const contactRoutes = require('./routes/contact');
const adminRoutes = require('./routes/admin');
const productRoutes = require('./routes/products');
const reviewRoutes = require('./routes/reviews');
const { getPublishedCmsPage } = require('./controllers/adminController');
const { ensureOwnerExists } = require('./controllers/adminController');

// Middleware (JWT auth can be applied per route where needed)
const app = express();
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  process.env.FRONTEND_URL,
].filter(Boolean));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS.'));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Intercept & log every raw request to /webhook
app.use('/webhook', (req, _res, next) => {
  console.log('🔥 RAW WEBHOOK HIT:', req.method, req.url, JSON.stringify(req.body));
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

app.use((error, _req, res, _next) => {
  console.error(`Request failed (${error.code || error.name || 'SERVER_ERROR'}).`);
  if (res.headersSent) return;
  return res.status(500).json({ message: 'The request could not be completed.' });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();
    await ensureOwnerExists();
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
  } catch (err) {
    console.error('Backend startup failed:', err.message);
    process.exitCode = 1;
  }
};

startServer();

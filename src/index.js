// src/index.js
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const { isAllowedOrigin } = require('./config/allowedOrigins');

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

// Database connection for Serverless / Local startup
connectDB()
  .then(() => ensureOwnerExists().catch(err => console.error('Error ensuring owner exists:', err)))
  .catch(err => console.error('MongoDB connection failed:', err.message));

const corsOptions = {
  origin(origin, callback) {
    // Disallowed origins get no CORS headers (browser blocks them) instead of a 500.
    callback(null, !origin || isAllowedOrigin(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

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

// Local development ke liye app.listen (Vercel imports this file, so yeh execute nahi hoga)
if (require.main === module) {
  app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
}

// @vercel/node calls the export as (req, res), so export the Express app directly.
module.exports = app;
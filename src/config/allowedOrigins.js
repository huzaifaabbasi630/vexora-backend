const LOCAL_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const normalizeOrigin = (value) => (value || '').trim().replace(/\/+$/, '').toLowerCase();

// FRONTEND_URL may hold one or more comma-separated origins, with or without trailing slashes.
const configuredOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

const allowedOrigins = new Set([...configuredOrigins, ...LOCAL_ORIGINS]);

const isAllowedOrigin = (origin) => allowedOrigins.has(normalizeOrigin(origin));

module.exports = { allowedOrigins, isAllowedOrigin, normalizeOrigin };

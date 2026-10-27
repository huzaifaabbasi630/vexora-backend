const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env') })

const axios = require('axios')
const cors = require('cors')
const express = require('express')
const connectDB = require('./src/config/db')
const productRoutes = require('./src/routes/products')
const webhookRoutes = require('./src/routes/webhook')
const { getWhatsAppConfigStatus } = require('./src/utils/whatsapp')
const { getEmailConfigStatus } = require('./src/utils/email')
const { getPublishedCmsPage } = require('./src/controllers/adminController')

const app = express()
const port = Number(process.env.PORT) || 5000
const allowedOrigins = [
  'https://vexora-frontend.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:3000',
]

console.log('WhatsApp configuration status:', getWhatsAppConfigStatus())
console.log('Email configuration status:', getEmailConfigStatus())

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '32kb' }));
const orderRoutes = require('./src/routes/order');
app.use('/api', orderRoutes);
app.use('/api/products', productRoutes);
app.get('/api/content/:slug', (req, res, next) => {
  Promise.resolve(getPublishedCmsPage(req, res)).catch(next);
});

connectDB().catch((error) => console.error('Database initialization failed:', error));

app.use('/webhook', (req, _res, next) => {
  console.log('📩 WhatsApp webhook HTTP request received:', req.method, req.path);
  next();
});
app.use('/webhook', webhookRoutes);

function formatOrderMessage({ customerInfo, cartItems, total }) {
  const itemLines = cartItems.map(
    (item) => `- ${item.name} x ${item.qty} = RS ${item.price * item.qty}`
  )

  return [
    '----------------------------------',
    '🛒 *NEW ORDER RECEIVED!*',
    '----------------------------------',
    `👤 *Customer:* ${customerInfo.name}`,
    `📞 *Phone:* ${customerInfo.phone}`,
    `📍 *Address:* ${customerInfo.address}`,
    '',
    '🛍️ *Items:*',
    ...itemLines,
    '',
    `💰 *Total Amount:* RS ${total}`,
    '----------------------------------',
  ].join('\n')
}

function validateOrder(body) {
  const { customerInfo, cartItems } = body || {}
  const name = typeof customerInfo?.name === 'string' ? customerInfo.name.trim() : ''
  const phone = typeof customerInfo?.phone === 'string' ? customerInfo.phone.trim() : ''
  const address = typeof customerInfo?.address === 'string' ? customerInfo.address.trim() : ''

  if (!name || name.length > 100) {
    return { error: 'Enter a customer name (up to 100 characters).' }
  }
  if (!phone || phone.length > 20 || !/^\+?[\d\s()-]+$/.test(phone)) {
    return { error: 'Enter a valid customer phone number.' }
  }
  const phoneDigits = phone.replace(/\D/g, '')
  if (phoneDigits.length < 8 || phoneDigits.length > 15) {
    return { error: 'Enter a valid customer phone number.' }
  }
  if (!address || address.length > 500) {
    return { error: 'Enter a delivery address (up to 500 characters).' }
  }
  if (!Array.isArray(cartItems) || cartItems.length === 0 || cartItems.length > 50) {
    return { error: 'The order must contain between 1 and 50 items.' }
  }

  const normalizedItems = []
  for (const item of cartItems) {
    const itemName = typeof item?.name === 'string' ? item.name.trim() : ''
    const qty = Number(item?.qty)
    const price = Number(item?.price)
    if (
      !itemName ||
      itemName.length > 150 ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > 100 ||
      !Number.isFinite(price) ||
      price < 0 ||
      price > 10000000
    ) {
      return { error: 'One or more order items are invalid.' }
    }
    normalizedItems.push({ name: itemName, qty, price })
  }

  const total = normalizedItems.reduce((sum, item) => sum + item.price * item.qty, 0)
  if (!Number.isSafeInteger(total)) {
    return { error: 'The order total is invalid.' }
  }

  return {
    order: {
      customerInfo: { name, phone, address },
      cartItems: normalizedItems,
      total,
    },
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// POST /api/checkout – validates order, sends WhatsApp notification
app.post('/api/checkout', async (req, res) => {
  // Log the raw request body for debugging
  console.log('🔔 Incoming checkout request body:', req.body);
  try {
    // Validate request payload using the helper
    const validation = validateOrder(req.body);
    if (validation.error) {
      console.error('❗ Validation error:', validation.error);
      return res.status(400).json({ message: validation.error });
    }

    // Ensure required environment variables are present
    const { META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, OWNER_PHONE_NUMBER } = process.env;
    if (!META_ACCESS_TOKEN || META_ACCESS_TOKEN === 'YOUR_PERMANENT_META_ACCESS_TOKEN' || !META_PHONE_NUMBER_ID || !OWNER_PHONE_NUMBER) {
      console.warn('⚠️ Missing WhatsApp configuration');
      return res.status(503).json({ message: 'Order notifications are not configured. Please contact the store.' });
    }

    const { order } = validation;
    const formattedMessage = formatOrderMessage(order);

    // Send WhatsApp notification
    await axios.post(
      `https://graph.facebook.com/v20.0/${META_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: OWNER_PHONE_NUMBER,
        type: 'text',
        text: { body: formattedMessage },
      },
      {
        headers: {
          Authorization: `Bearer ${META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    return res.status(200).json({ message: 'Order notification sent successfully.' });
  } catch (error) {
    console.error("WHATSAPP SEND ERROR RESPONSE:", error.response ? error.response.data : error.message);
    // If the error originated from validation, ensure a 400 response
    if (error?.isValidation) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({
      message: 'We could not send your order notification. Please try again.',
      error: error.response?.data || error.message,
    });
  }
});

app.use((error, _req, res, _next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body must contain valid JSON.' })
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body is too large.' })
  }
  console.error('Unhandled request error:', error)
  return res.status(500).json({ message: 'An unexpected server error occurred.' })
})

app.listen(port, () => {
  console.log(`Order notification API listening on port ${port}`)
})

// src/utils/whatsapp.js
const axios = require('axios');

const BASE_URL = 'https://graph.facebook.com';

function getHeaders() {
  const accessToken = process.env.WHATSAPP_TOKEN || process.env.META_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('WhatsApp access token is not configured.');
  }

  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function sendWhatsAppMessage(payload, apiVersion = 'v25.0') {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    throw new Error('WhatsApp phone number ID is not configured.');
  }

  try {
    const response = await axios.post(
      `${BASE_URL}/${apiVersion}/${phoneNumberId}/messages`,
      payload,
      { headers: getHeaders(), timeout: 15000 }
    );

    return response.data;
  } catch (error) {
    console.error('❌ WhatsApp API Error:', error.response?.data || error.message);
    throw error;
  }
}

// ─── Phone Number Formatter ────────────────────────────────────────────────────

/**
 * Converts any Pakistani (or international) phone number into the format
 * required by the Meta WhatsApp Cloud API: digits only, no leading +, no spaces.
 *
 * Examples:
 *   "03213794233"      → "923213794233"
 *   "+923213794233"    → "923213794233"
 *   "923213794233"     → "923213794233"
 *   "0321 379 4233"    → "923213794233"
 *   "+92-321-3794233"  → "923213794233"
 *
 * @param {string} rawPhone - Phone number as entered by the user
 * @returns {string} - Digits-only international number (e.g. "923213794233")
 */
function formatPhoneNumber(rawPhone) {
  // Strip everything except digits
  let digits = String(rawPhone).replace(/\D/g, '');

  // Pakistani local number starting with 0 (e.g. 03xxxxxxxxx → 92 3xxxxxxxxx)
  if (digits.startsWith('0') && digits.length === 11) {
    digits = '92' + digits.slice(1);
  }

  // Already prefixed with 92 but no leading plus – leave as-is
  // (e.g. "923213794233" stays "923213794233")

  return digits;
}

// ─── Customer Confirmation Text Message ───────────────────────────────────────

/**
 * Send a plain-text WhatsApp confirmation message to the CUSTOMER
 * immediately after their order is placed, containing the confirm link.
 *
 * @param {string} customerPhone - Raw phone as typed (e.g. "03213794233")
 * @param {string} customerName  - Customer name for personalisation
 * @param {string} confirmLink   - The confirmation URL
 * @param {object} order         - Mongoose Order document (for items/total)
 */
async function sendCustomerConfirmationMessage(customerPhone, customerName, confirmLink, order) {
  const to = formatPhoneNumber(customerPhone);

  const itemLines = order.cartItems
    .map((item) => {
      const variant = [item.selectedSize && `Size ${item.selectedSize}`, item.selectedColor && `Color ${item.selectedColor}`]
        .filter(Boolean)
        .join(', ');
      return `• ${item.name}${variant ? ` (${variant})` : ''} ×${item.qty}  –  RS ${(item.price * item.qty).toLocaleString()}`;
    })
    .join('\n');

  const text = [
    `Assalam-o-Alaikum ${customerName}! 👋`,
    '',
    'Thank you for shopping at *Vexora*! 🛍️',
    '',
    '📦 *Your Order Summary:*',
    itemLines,
    `💰 *Total:* RS ${order.total.toLocaleString()}`,
    '',
    '✅ *Please confirm your order by clicking the link below:*',
    confirmLink,
    '',
    '⏳ This link expires in 24 hours.',
    'If you did not place this order, please ignore this message.',
    '',
    '— Team Vexora',
  ].join('\n');

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  };

  return sendWhatsAppMessage(payload);
}

async function sendCustomerOrderConfirmedMessage(customerPhone, orderId) {
  const payload = {
    messaging_product: 'whatsapp',
    to: formatPhoneNumber(customerPhone),
    type: 'text',
    text: {
      body: `🎉 Order Confirmed! (ID: #${orderId}) \n Shukriya! Aapka order successfully confirm ho gaya hai.`,
    },
  };

  return sendWhatsAppMessage(payload, 'v17.0');
}

// ─── Owner Interactive Message (Dispatched / On The Way buttons) ──────────────

/**
 * Send an interactive WhatsApp message with 2 reply buttons to the store owner.
 * Button IDs: BTN_DISPATCHED_<orderId> and BTN_ON_THE_WAY_<orderId>
 *
 * @param {string} toPhone  - Owner phone in international format (e.g. "923122534885")
 * @param {object} order    - Mongoose Order document
 */
async function sendOrderInteractiveMessage(toPhone, order) {
  const { customerInfo, cartItems, total, _id } = order;
  const to = formatPhoneNumber(toPhone);

  const itemLines = cartItems
    .map((item) => {
      const variant = [item.selectedSize && `Size ${item.selectedSize}`, item.selectedColor && `Color ${item.selectedColor}`]
        .filter(Boolean)
        .join(', ');
      return `* ${item.name}${variant ? ` (${variant})` : ''} x${item.qty} = RS ${(item.price * item.qty).toLocaleString()}`;
    })
    .join('\n');

  const backendUrl = (process.env.RENDER_URL || 'https://vexora-backend-rniq.onrender.com').replace(/\/+$/, '');
  const dispatchedLink = `${backendUrl}/api/orders/${_id}/status/Dispatched`;
  const onTheWayLink    = `${backendUrl}/api/orders/${_id}/status/On%20The%20Way`;

  const bodyText = [
    '🛒 NEW CONFIRMED ORDER',
    '─────────────────────',
    `👤 Name: ${customerInfo.name}`,
    `📞 Phone: ${customerInfo.phone}`,
    `📍 Address: ${customerInfo.address}`,
    `📧 Email: ${customerInfo.email}`,
    '',
    '🛍️ Items:',
    itemLines,
    '',
    `💰 Total: RS ${total.toLocaleString()}`,
    '─────────────────────',
    `🆔 Order ID: ${_id}`,
    '',
    '⚡ Quick Actions:',
    `🚚 Dispatched: ${dispatchedLink}`,
    `🛵 On The Way: ${onTheWayLink}`,
  ].join('\n');

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: `dispatched_${_id}`,
              title: '🚚 Dispatched',
            },
          },
          {
            type: 'reply',
            reply: {
              id: `on_the_way_${_id}`,
              title: '🛵 On The Way',
            },
          },
        ],
      },
    },
  };

  return sendWhatsAppMessage(payload);
}

// ─── Owner Template Message (Approved Meta Template) ────────────────────────

/**
 * Send an approved WhatsApp template message to the store OWNER
 * when a new order is confirmed.
 *
 * Template name : jaspers_market_order_confirmation_v1
 * Language      : en_US
 * Body params   : {{1}} customerName  |  {{2}} orderId  |  {{3}} formattedDate
 *
 * This works on Meta test phone numbers (unlike plain-text or interactive
 * messages which require a fully approved WABA number).
 *
 * @param {string} ownerPhoneNumber - Owner phone in any format (will be normalised)
 * @param {object} order            - Mongoose Order document
 */
async function sendOwnerTemplateMessage(ownerPhoneNumber, order) {
  const to = formatPhoneNumber(ownerPhoneNumber);

  const customerName  = order.customerInfo?.name  || 'Customer';
  const orderIdString = String(order._id);
  const formattedDate = new Date(order.confirmedAt || Date.now()).toLocaleString('en-PK', {
    timeZone: 'Asia/Karachi',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: 'jaspers_market_order_confirmation_v1',
      language: { code: 'en_US' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: customerName  },
            { type: 'text', text: orderIdString },
            { type: 'text', text: formattedDate },
          ],
        },
      ],
    },
  };

  return sendWhatsAppMessage(payload);
}

// ─── Generic Plain-Text Sender ────────────────────────────────────────────────

/**
 * Send a plain text WhatsApp message.
 * @param {string} toPhone - Raw or formatted phone number
 * @param {string} text
 */
async function sendWhatsAppText(toPhone, text) {
  const to = formatPhoneNumber(toPhone);

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  };

  return sendWhatsAppMessage(payload);
}

module.exports = {
  formatPhoneNumber,
  sendCustomerConfirmationMessage,
  sendCustomerOrderConfirmedMessage,
  sendOrderInteractiveMessage,
  sendOwnerTemplateMessage,
  sendWhatsAppText,
};

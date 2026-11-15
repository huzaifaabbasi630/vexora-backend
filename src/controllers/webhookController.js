// src/controllers/webhookController.js
const Order = require('../models/Order');
const { sendOrderStatusNotifications } = require('../utils/orderStatusNotifications');
const { sendOrderConfirmationNotifications } = require('../utils/orderConfirmationNotifications');
const {
  sendCustomerConfirmationMessage,
  sendOrderInteractiveMessage,
  sendOwnerTemplateMessage,
} = require('../utils/whatsapp');

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── GET /webhook – Meta verification handshake ───────────────────────────────

exports.verifyWebhook = (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.HUB_VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verification request succeeded.');
    return res.status(200).send(challenge);
  }

  console.warn('❌ WhatsApp webhook verification failed: mode or verify token did not match.');
  return res.sendStatus(403);
};

// ─── POST /webhook – Handle incoming events from Meta ────────────────────────

exports.handleWebhook = async (req, res) => {
  // Always acknowledge immediately so Meta doesn't retry
  res.sendStatus(200);

  console.log('📩 WhatsApp webhook payload accepted for processing.');

  try {
    const entry   = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;
    const message = value?.messages?.[0];

    // Not a message event (e.g. delivery receipts / read receipts) — ignore
    if (!message) {
      console.log('ℹ️ WhatsApp webhook contains no incoming message; ignoring status/receipt event.');
      return;
    }

    // Extract sender phone number
    const fromNumber = message.from;
    console.log('📨 Incoming WhatsApp message received:', {
      messageType: message.type,
      senderLast4: typeof fromNumber === 'string' ? fromNumber.slice(-4) : null,
    });

    // Handle button clicks (existing functionality)
    let buttonId = null;

    if (message && message.type === 'interactive' && message.interactive?.type === 'button_reply') {
      buttonId = message.interactive.button_reply.id;
    } else if (message?.type === 'interactive') {
      buttonId = message.interactive?.button_reply?.id;
    }

    if (buttonId) {
      // Handle existing button click logic (Dispatched / On The Way)
      console.log('🔘 WhatsApp interactive button reply received.');
      await handleButtonClick(buttonId);
      return;
    }

    // Handle text messages for order confirmation
    if (message?.type === 'text') {
      const textBody = message.text?.body || '';
      console.log('💬 WhatsApp text message received; checking for an order confirmation ID.');

      // Check if message contains # followed by Order ID
      const orderMatch = textBody.match(/#([a-f0-9]{24})/i);
      
      if (orderMatch) {
        const orderId = orderMatch[1];
        console.log('🔍 Order ID found in WhatsApp confirmation message:', orderId);
        await handleOrderConfirmation(orderId, fromNumber);
      } else {
        console.log('ℹ️ WhatsApp text did not contain the expected #<24-character order ID>.');
      }
      return;
    }

    console.log('ℹ️  Message received but not a recognized type:', message?.type);

  } catch (err) {
    console.error('❌ DETAILED WEBHOOK ERROR:', err);
  }
};

// ─── Handle Button Click (Dispatched / On The Way) ───────────────────────────

async function handleButtonClick(buttonId) {
  try {
    // Button ID ko split karke Action aur Order ID nikalein
    // e.g. "dispatched_6acca57b3094d89458a64cb8" or "on_the_way_6acca57b3094d89458a64cb8"
    let action, orderId;
    if (buttonId.startsWith('dispatched_')) {
      action = 'dispatched';
      orderId = buttonId.slice('dispatched_'.length);
    } else if (buttonId.startsWith('on_the_way_')) {
      action = 'on_the_way';
      orderId = buttonId.slice('on_the_way_'.length);
    } else {
      const parts = buttonId.split('_');
      action = parts[0];
      orderId = parts.slice(1).join('_');
    }

    console.log("🔘 BUTTON CLICKED - Action:", action, "Order ID:", orderId);

    const validStatus = (action === 'dispatched' || action.toLowerCase().includes('dispatch')) 
      ? 'Dispatched' 
      : 'On The Way';
    if (!orderId || orderId.length < 10) {
      console.error('❌ Parsed orderId looks invalid:', orderId, '(from buttonId:', buttonId, ')');
      return;
    }

    // Order Database Search
    console.log("🔍 SEARCHING ORDER IN DB FOR ID:", orderId);
    const foundOrder = await Order.findById(orderId);
    console.log("📦 ORDER FOUND STATUS:", foundOrder ? "YES" : "NO");

    if (!foundOrder) {
      console.error(`❌ Order not found in DB for ID: "${orderId}"`);
      return;
    }

    console.log(`📦 Order details: #${foundOrder._id} | customer: ${foundOrder.customerInfo?.name} | current status: ${foundOrder.status}`);

    const allowedTransitions = {
      Confirmed: ['Dispatched', 'On The Way'],
      Dispatched: ['Dispatched', 'On The Way'],
      'On The Way': ['On The Way'],
    };
    if (!allowedTransitions[foundOrder.status]?.includes(validStatus)) {
      console.warn(`⚠️ Order #${orderId} cannot move from "${foundOrder.status}" to "${validStatus}".`);
      return;
    }

    if (foundOrder.status !== validStatus) {
      foundOrder.status = validStatus;
      await foundOrder.save();
      console.log(`✅ Order #${orderId} status updated: "${validStatus}"`);
    } else {
      console.log(`🔁 Retrying undelivered "${validStatus}" notifications for order #${orderId}.`);
    }

    await sendOrderStatusNotifications(foundOrder, validStatus);

  } catch (err) {
    console.error('❌ BUTTON CLICK ERROR:', err);
  }
}

// ─── Handle Order Confirmation via WhatsApp Text Message ───────────────────

async function handleOrderConfirmation(orderId, fromNumber) {
  try {
    console.log('🔄 WhatsApp order confirmation flow started:', orderId);
    // Validate order ID
    if (!orderId || orderId.length !== 24) {
      console.error('❌ Invalid order ID format:', orderId);
      return;
    }

    // Search for order in database
    console.log('🔍 Looking up order for WhatsApp confirmation:', orderId);
    const order = await Order.findById(orderId);
    console.log('📦 Order lookup completed:', { found: Boolean(order), status: order?.status || null });

    if (!order) {
      console.error(`❌ Order not found in DB for ID: "${orderId}"`);
      return;
    }

    console.log(`📦 Order #${order._id} current status: ${order.status}`);

    if (!['Pending Confirmation', 'Confirmed'].includes(order.status)) {
      console.warn(`⚠️ Order #${orderId} cannot process confirmation notifications from status "${order.status}".`);
      return;
    }

    if (order.status === 'Pending Confirmation') {
      order.status = 'Confirmed';
      order.confirmedAt = new Date();
      order.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await order.save();
      console.log(`✅ Order #${orderId} status updated to: "Confirmed"`);
    } else {
      console.log(`🔁 Retrying undelivered confirmation notifications for order #${orderId}.`);
    }

    // Send customer notifications and owner alert without blocking one channel on another.
    await Promise.allSettled([
      sendOrderConfirmationNotifications(order),

      // Send WhatsApp alert with interactive buttons to owner.
      (async () => {
        const sentNotifications = order.confirmationNotifications || {};
        if (sentNotifications.ownerWhatsAppSentAt) {
          console.log(`ℹ️ Owner WhatsApp already sent for order #${orderId}; skipping.`);
          return;
        }
        try {
          const { OWNER_PHONE_NUMBER } = process.env;
          if (OWNER_PHONE_NUMBER) {
            console.log('📤 Starting owner WhatsApp notification for confirmed order:', orderId);
            await sendOrderInteractiveMessage(OWNER_PHONE_NUMBER, order);
            await Order.updateOne(
              { _id: order._id },
              { $set: { 'confirmationNotifications.ownerWhatsAppSentAt': new Date() } }
            );
            console.log('📲 Owner WhatsApp notification completed:', orderId);
          } else {
            console.warn('⚠️  OWNER_PHONE_NUMBER not set – skipping owner WhatsApp');
          }
        } catch (err) {
          console.error('❌ Owner WhatsApp failed:', err.message);
        }
      })(),
    ]);

    console.log(`✅ WhatsApp order confirmation workflow completed for order #${orderId} (sender ending ${String(fromNumber || '').slice(-4)}).`);

  } catch (err) {
    console.error('❌ WhatsApp order confirmation workflow failed:', err.response?.data || err.message);
  }
}

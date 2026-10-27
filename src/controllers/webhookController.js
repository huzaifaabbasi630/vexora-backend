// src/controllers/webhookController.js
const Order = require('../models/Order');
const { sendOrderStatusEmail } = require('../utils/orderStatusEmail');
const { sendEmailConfirmation } = require('../utils/orderConfirmationEmail');
const {
  formatPhoneNumber,
  sendCustomerConfirmationMessage,
  sendOrderInteractiveMessage,
  sendOwnerTemplateMessage,
  sendWhatsAppText,
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

    // ── IDEMPOTENCY CHECK: Prevent duplicate notifications ──
    if (foundOrder.status === validStatus) {
      console.log(`⚠️  Order #${orderId} is already "${validStatus}". Skipping duplicate notifications.`);
      return;
    }

    // Update order status
    foundOrder.status = validStatus;
    await foundOrder.save();
    console.log(`✅ Order #${orderId} status updated: "${validStatus}"`);

    const { email, phone, name } = foundOrder.customerInfo || {};

    // ── SIMULTANEOUS NOTIFICATIONS: Email + WhatsApp ──
    await Promise.allSettled([
      // Send email to customer
      (async () => {
        if (!email) {
          console.warn(`⚠️  No email in customerInfo for order #${orderId} — skipping email.`);
          return;
        }
        console.log("📧 ATTEMPTING TO SEND STATUS EMAIL TO:", email);
        try {
          await sendOrderStatusEmail(foundOrder, validStatus);
          console.log("✅ STATUS EMAIL SENT SUCCESSFULLY");
        } catch (emailErr) {
          console.error("❌ EMAIL SENDING FAILED:", emailErr.message || emailErr);
        }
      })(),

      // Send WhatsApp message to customer
      (async () => {
        if (!phone) {
          console.warn(`⚠️  No phone in customerInfo for order #${orderId} — skipping WhatsApp.`);
          return;
        }
        try {
          const formattedPhone = formatPhoneNumber(phone);
          const orderShortId = String(foundOrder._id).slice(-6);
          const customerName = name || 'Customer';
          
          const statusMessage = [
            `🚚 *Order Update!*`,
            '',
            `Dear ${customerName}, aapka order #${orderShortId} status update ho kar *${validStatus}* ho gaya hai.`,
            '',
            validStatus === 'Dispatched' 
              ? 'Aapka order dispatch ho gaya hai. Tracking details share ki jayegi.' 
              : 'Aapka order ab delivery ke raaste par hai. Jald hi pahunch jayega!',
            '',
            'Agar koi sawal ho to WhatsApp karein.',
          ].join('\n');
          
          await sendWhatsAppText(formattedPhone, statusMessage);
          console.log(`✅ "${validStatus}" WhatsApp sent to customer: ${formattedPhone}`);
        } catch (waErr) {
          console.error("❌ WHATSAPP SENDING FAILED:", waErr.message || waErr);
        }
      })(),
    ]);

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

    // Check if order is in PENDING status (prevent duplicate processing)
    if (order.status !== 'Pending Confirmation') {
      console.warn(`⚠️  Order #${orderId} is not in Pending Confirmation status. Current status: ${order.status}`);
      return;
    }

    // ── SIMULTANEOUS ACTIONS: Update status, send email, send WhatsApp messages ──
    
    // 1. Update order status to CONFIRMED
    order.status = 'Confirmed';
    order.confirmedAt = new Date();
    // Extend expiry to 30 days for confirmed orders
    order.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await order.save();
    console.log(`✅ Order #${orderId} status updated to: "Confirmed"`);

    // Execute all notifications in parallel
    await Promise.allSettled([
      // 2. Send confirmation email to customer
      (async () => {
        try {
          await sendEmailConfirmation(order);
          console.log('📧 Confirmation email sent to:', order.customerInfo.email);
        } catch (err) {
          console.error('❌ Email sending failed:', err.message);
        }
      })(),

      // 3. Send WhatsApp receipt to customer
      (async () => {
        try {
          console.log('📤 Starting WhatsApp confirmation reply to customer:', {
            orderId,
            recipientLast4: typeof fromNumber === 'string' ? fromNumber.slice(-4) : null,
          });

          // Build detailed order receipt message
          const orderShortId = String(order._id).slice(-6);
          const customerName = order.customerInfo?.name || 'Customer';
          const deliveryAddress = order.customerInfo?.address || 'Not provided';
          
          // Format items list
          const itemsList = order.cartItems
            .map((item, index) => {
              const variantInfo = [];
              if (item.selectedSize) variantInfo.push(`Size: ${item.selectedSize}`);
              if (item.selectedColor) variantInfo.push(`Color: ${item.selectedColor}`);
              const variantText = variantInfo.length > 0 ? ` (${variantInfo.join(', ')})` : '';
              
              return `${index + 1}. *${item.name}*${variantText}\n   Qty: ${item.qty} - Rs. ${item.price.toLocaleString()}`;
            })
            .join('\n\n');
          
          const customerMessage = [
            `🎉 *Order Confirmed!* (ID: #${orderShortId})`,
            '',
            `Shukriya ${customerName}! Aapka order successfully confirm ho gaya hai. Aapki details yeh hain:`,
            '─────────────────────────',
            itemsList,
            '─────────────────────────',
            `💰 *Total Amount:* Rs. ${order.total.toLocaleString()}`,
            `📍 *Delivery Address:* ${deliveryAddress}`,
            '',
            'Hum jald hi aapka order dispatch kar dein ge! 🚚',
          ].join('\n');
          
          await sendWhatsAppText(fromNumber, customerMessage);
          console.log('📲 WhatsApp confirmation reply completed for the customer sender.');
        } catch (err) {
          console.error('❌ Customer WhatsApp failed:', err.response?.data || err.message);
        }
      })(),

      // 4. Send WhatsApp alert with interactive buttons to owner
      (async () => {
        try {
          const { OWNER_PHONE_NUMBER } = process.env;
          if (OWNER_PHONE_NUMBER) {
            console.log('📤 Starting owner WhatsApp notification for confirmed order:', orderId);
            await sendOrderInteractiveMessage(OWNER_PHONE_NUMBER, order);
            console.log('📲 Owner WhatsApp notification completed:', orderId);
          } else {
            console.warn('⚠️  OWNER_PHONE_NUMBER not set – skipping owner WhatsApp');
          }
        } catch (err) {
          console.error('❌ Owner WhatsApp failed:', err.message);
        }
      })(),
    ]);

    console.log(`✅ WhatsApp order confirmation workflow completed for order #${orderId}.`);

  } catch (err) {
    console.error('❌ WhatsApp order confirmation workflow failed:', err.response?.data || err.message);
  }
}

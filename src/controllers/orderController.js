// src/controllers/orderController.js
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { sendEmail } = require('../utils/email');
const { sendOrderStatusEmail } = require('../utils/orderStatusEmail');
const {
  formatPhoneNumber,
  sendCustomerConfirmationMessage,
  sendOrderInteractiveMessage,
  sendOwnerTemplateMessage,
} = require('../utils/whatsapp');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return the date N days from now */
function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** Build an HTML order summary table for emails */
function buildOrderSummaryHtml(cartItems, total) {
  const rows = cartItems
    .map(
      (item) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #E5DED5;color:#1A1512;">${escapeHtml(item.name)}${item.selectedSize || item.selectedColor ? `<br><span style="font-size:12px;color:#6F4E37;">${item.selectedSize ? `Size: ${escapeHtml(item.selectedSize)}` : ''}${item.selectedSize && item.selectedColor ? ' · ' : ''}${item.selectedColor ? `Color: ${escapeHtml(item.selectedColor)}` : ''}</span>` : ''}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #E5DED5;text-align:center;color:#1A1512;">${item.qty}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #E5DED5;text-align:right;color:#1A1512;">RS ${item.price.toLocaleString()}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #E5DED5;text-align:right;color:#1A1512;">RS ${(item.price * item.qty).toLocaleString()}</td>
        </tr>`
    )
    .join('');

  return `
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
      <thead>
        <tr style="background:#F3EFE9;color:#1A1512;">
          <th style="padding:8px 12px;text-align:left;">Item</th>
          <th style="padding:8px 12px;text-align:center;">Qty</th>
          <th style="padding:8px 12px;text-align:right;">Price</th>
          <th style="padding:8px 12px;text-align:right;">Subtotal</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr style="background:#F3EFE9;color:#1A1512;font-weight:bold;">
          <td colspan="3" style="padding:10px 12px;text-align:right;">Total:</td>
          <td style="padding:10px 12px;text-align:right;">RS ${total.toLocaleString()}</td>
        </tr>
      </tfoot>
    </table>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

// ─── POST /api/checkout ───────────────────────────────────────────────────────

exports.checkout = async (req, res) => {
  try {
    const { customerInfo, cartItems } = req.body || {};

    // ── Validation ────────────────────────────────────────────────────────────
    if (!customerInfo || typeof customerInfo !== 'object' || Array.isArray(customerInfo)) {
      return res.status(400).json({
        message: 'customerInfo is required.',
      });
    }
    if (['name', 'phone', 'address', 'email'].some((key) => typeof customerInfo[key] !== 'string')) {
      return res.status(400).json({ message: 'Name, phone, address, and email must be text values.' });
    }

    const name = (customerInfo.name || '').trim();
    const phone = (customerInfo.phone || '').trim();
    const address = (customerInfo.address || '').trim();
    const email = (customerInfo.email || '').trim();

    if (!name) {
      return res.status(400).json({
        message: 'Customer name is required.',
      });
    }
    if (name.length > 120 || phone.length > 40 || address.length > 1000 || email.length > 254
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Please provide valid customer details within the allowed length limits.' });
    }

    if (!phone) {
      return res.status(400).json({
        message: 'Customer phone is required.',
      });
    }

    if (!address) {
      return res.status(400).json({
        message: 'Delivery address is required.',
      });
    }

    if (!email) {
      return res.status(400).json({
        message: 'Customer email is required to send the confirmation link.',
      });
    }

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({
        message: 'Cart is empty.',
      });
    }

    if (cartItems.length > 30) {
      return res.status(400).json({ message: 'A single order may contain at most 30 cart lines.' });
    }

    const orderItems = [];
    for (const item of cartItems) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return res.status(400).json({ message: 'Every cart line must be a product object.' });
      }
      const productKey = typeof item.productId === 'string' ? item.productId.trim() : '';
      const qty = Number(item.qty);
      if (!productKey || productKey.length > 180 || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        return res.status(400).json({ message: 'Each cart line must include a valid product and quantity from 1 to 20.' });
      }
      const product = await Product.findOne({
        status: 'published',
        $or: [{ _id: mongoose.isValidObjectId(productKey) ? productKey : null }, { legacyId: productKey }, { slug: productKey }],
      }).lean();
      if (!product) return res.status(400).json({ message: 'One or more cart products are no longer available. Refresh the catalog and try again.' });

      const selectedSize = typeof item.selectedSize === 'string' ? item.selectedSize.trim().slice(0, 40) : '';
      const selectedColor = typeof item.selectedColor === 'string' ? item.selectedColor.trim().slice(0, 80) : '';
      if (product.sizes.length && (!selectedSize || !product.sizes.includes(selectedSize))) {
        return res.status(400).json({ message: `Select a valid size for ${product.name}.` });
      }
      if (product.colors.length && (!selectedColor || !product.colors.includes(selectedColor))) {
        return res.status(400).json({ message: `Select a valid color for ${product.name}.` });
      }
      if (product.variants.length && !product.variants.some((variant) =>
        variant.size === selectedSize && variant.color === selectedColor
      )) {
        return res.status(400).json({ message: `That size and color combination is unavailable for ${product.name}.` });
      }
      if (product.trackInventory) {
        const variant = product.variants.find((entry) => entry.size === selectedSize && entry.color === selectedColor);
        const available = variant ? variant.stock : product.stock;
        if (available < qty) return res.status(409).json({ message: `Insufficient stock for ${product.name}.` });
      }

      orderItems.push({
        productId: product._id,
        productSlug: product.slug,
        sku: product.sku || '',
        name: product.name,
        qty,
        price: product.salePrice ?? product.regularPrice,
        total: (product.salePrice ?? product.regularPrice) * qty,
        selectedSize,
        selectedColor,
      });
    }

    const total = orderItems.reduce((sum, item) => sum + item.total, 0);

    // ── Save order as Pending Confirmation ────────────────────────────────────
    const order = await Order.create({
      customerInfo: {
        name,
        phone,
        address,
        email,
      },
      cartItems: orderItems,
      total,
      status: 'Pending Confirmation',
      expiresAt: daysFromNow(1),
    });

    console.log('✅ Order saved:', order._id);

    // ── DEFERRED NOTIFICATION: No email or WhatsApp sent during checkout ───────
    // Notifications will be triggered after customer confirms via WhatsApp

    return res.status(200).json({
      message: 'Order received! Please confirm via WhatsApp.',
      orderId: order._id,
    });

  } catch (error) {
    console.error(
      'DETAILED CHECKOUT ERROR:',
      error.response?.data || error.message || error
    );

    return res.status(500).json({
      message: 'We could not process your order. Please try again.',
    });
  }
};

// ─── GET /api/orders/confirm/:orderId ─────────────────────────────────────────

exports.confirmOrder = async (req, res) => {
  let claimedOrder;
  const decremented = [];
  try {
    const { orderId } = req.params;
    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).send('<h2>Invalid order confirmation link.</h2>');
    }
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).send(`
        <h2>Order not found or link has expired.</h2>
        <p>Your confirmation link may have expired (24 hours). Please place your order again.</p>
      `);
    }

    if (order.status !== 'Pending Confirmation') {
      if (order.status === 'Confirming') {
        return res.status(409).send('<h2>Your order confirmation is being processed.</h2><p>Please wait a moment and open the link again.</p>');
      }
      return res.send(`
        <h2>Order Already Confirmed ✅</h2>
        <p>Your order #${order._id} has already been confirmed. We'll keep you updated!</p>
      `);
    }

    claimedOrder = await Order.findOneAndUpdate(
      { _id: order._id, status: 'Pending Confirmation' },
      { $set: { status: 'Confirming' } },
      { new: true }
    );
    if (!claimedOrder) {
      return res.status(409).send('<h2>This order confirmation link has already been used.</h2>');
    }

    for (const item of claimedOrder.cartItems) {
      if (!item.productId) continue;
      const product = await Product.findById(item.productId).lean();
      if (!product || product.status !== 'published') throw new Error(`Product is no longer available: ${item.name}.`);
      if (!product.trackInventory) continue;
      const variantExists = product.variants.some((variant) =>
        variant.size === item.selectedSize && variant.color === item.selectedColor
      );
      const filter = { _id: product._id, status: 'published' };
      const update = { $inc: {} };
      if (variantExists) {
        filter.variants = { $elemMatch: { size: item.selectedSize, color: item.selectedColor, stock: { $gte: item.qty } } };
        update.$inc['variants.$.stock'] = -item.qty;
      } else {
        filter.stock = { $gte: item.qty };
        update.$inc.stock = -item.qty;
      }
      const updatedProduct = await Product.findOneAndUpdate(filter, update, { new: true });
      if (!updatedProduct) throw new Error(`Insufficient stock to confirm ${item.name}.`);
      decremented.push({
        productId: product._id,
        qty: item.qty,
        variantExists,
        size: item.selectedSize,
        color: item.selectedColor,
      });
    }

    claimedOrder.status = 'Confirmed';
    claimedOrder.confirmedAt = new Date();
    claimedOrder.expiresAt = daysFromNow(30);
    await claimedOrder.save();
    const confirmedOrder = claimedOrder;

    console.log('✅ Order confirmed:', confirmedOrder._id);

    // ── Send WhatsApp interactive message to store owner ──────────────────────
    const { OWNER_PHONE_NUMBER } = process.env;

    if (OWNER_PHONE_NUMBER) {
      try {
        await sendOrderInteractiveMessage(OWNER_PHONE_NUMBER, confirmedOrder);
        console.log('📲 WhatsApp interactive buttons sent to owner');
      } catch (waErr) {
        console.error(
          '⚠️ WhatsApp owner notification failed:',
          waErr.response?.data || waErr.message
        );
      }
    } else {
      console.warn('⚠️ OWNER_PHONE_NUMBER not set – skipping WhatsApp');
    }

    // ── Return confirmation success page ─────────────────────────────────────
    return res.send(renderBrandedOrderPage({
      title: 'Order Confirmed | VEXORA',
      eyebrow: 'ORDER CONFIRMED',
      heading: 'Thank You for Your Order!',
      intro: `Thank you, ${confirmedOrder.customerInfo.name}.`,
      message: 'Your order is confirmed and the store owner has been notified. We will share delivery updates using the contact details provided at checkout.',
      orderId: confirmedOrder._id,
      icon: '&#10003;',
    }));

  } catch (error) {
    const rollbackResults = await Promise.allSettled(decremented.map((item) => {
      const filter = item.variantExists
        ? { _id: item.productId, variants: { $elemMatch: { size: item.size, color: item.color } } }
        : { _id: item.productId };
      const update = item.variantExists
        ? { $inc: { 'variants.$.stock': item.qty } }
        : { $inc: { stock: item.qty } };
      return Product.updateOne(filter, update);
    }));
    rollbackResults.forEach((result) => {
      if (result.status === 'rejected') console.error('Stock rollback failed during order confirmation:', result.reason?.message || 'Unknown database error.');
    });
    if (claimedOrder) {
      try {
        await Order.updateOne(
          { _id: claimedOrder._id, status: 'Confirming' },
          { $set: { status: 'Pending Confirmation' } }
        );
      } catch (resetError) {
        console.error('Order confirmation state rollback failed:', resetError.message);
      }
    }
    if (error.message?.startsWith('Insufficient stock')) {
      return res.status(409).send(`<h2>Order cannot be confirmed</h2><p>${escapeHtml(error.message)}</p><p>Please contact customer support for assistance.</p>`);
    }
    console.error('DETAILED CONFIRM ERROR:', error);

    return res.status(500).send(
      'A server error occurred. Please try again.'
    );
  }
};

// ─── GET /api/orders/:orderId/status/:status ──────────────────────────────────
// Allows one-click status update from owner WhatsApp message and triggers customer email

exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId, status } = req.params;
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).send('<h2>Order not found</h2>');
    }

    const validStatus =
      status === 'Dispatched' ? 'Dispatched' : 'On The Way';

    // ── IDEMPOTENCY CHECK: Prevent duplicate notifications ──
    if (order.status === validStatus) {
      console.log(`⚠️  Order #${orderId} is already "${validStatus}". Skipping duplicate notifications.`);
      return res.send(renderBrandedOrderPage({
        title: 'Order Already Updated | VEXORA',
        eyebrow: 'ORDER UPDATE',
        heading: 'Yeh Order Pehle Hi Update Ho Chuka Hai!',
        intro: `Order #${order._id}`,
        message: `⚠️ Yeh Order Pehle Hi Update Ho Chuka Hai! Order status is already ${validStatus}. No duplicate notifications were sent.`,
        orderId: order._id,
        icon: '&#9888;',
      }));
    }

    order.status = validStatus;
    await order.save();

    console.log(
      `✅ Order #${orderId} status updated: "${validStatus}"`
    );

    const { email, phone, name } = order.customerInfo || {};
    let emailSent = false;
    let whatsappSent = false;

    // ── SIMULTANEOUS NOTIFICATIONS: Email + WhatsApp ──
    await Promise.allSettled([
      // Send email to customer
      (async () => {
        if (!email) {
          console.warn(`⚠️  No email in customerInfo for order #${orderId} — skipping email.`);
          return;
        }
        console.log(`📧 Sending "${validStatus}" status email to:`, email);
        try {
          await sendOrderStatusEmail(order, validStatus);
          emailSent = true;
          console.log(`✅ "${validStatus}" email sent to ${email}`);
        } catch (mailErr) {
          console.error('❌ Email error:', mailErr.message);
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
          const orderShortId = String(order._id).slice(-6);
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
          whatsappSent = true;
          console.log(`✅ "${validStatus}" WhatsApp sent to ${formattedPhone}`);
        } catch (waErr) {
          console.error('❌ WhatsApp error:', waErr.message);
        }
      })(),
    ]);

    const notificationNotice = [];
    if (emailSent) notificationNotice.push('email');
    if (whatsappSent) notificationNotice.push('WhatsApp');
    const noticeText = notificationNotice.length > 0 
      ? `Customer notification (${notificationNotice.join(' & ')}) has been sent.`
      : 'No customer notifications were sent (missing contact info).';

    return res.send(renderBrandedOrderPage({
      title: 'Order Status Updated | VEXORA',
      eyebrow: 'ORDER UPDATE',
      heading: validStatus === 'Dispatched' ? 'Your Order Is Dispatched!' : 'Your Order Is On The Way!',
      intro: `Order #${order._id}`,
      message: `Current status: ${validStatus}. ${noticeText}`,
      orderId: order._id,
      icon: validStatus === 'Dispatched' ? '&#128666;' : '&#128652;',
    }));

  } catch (err) {
    console.error('Status update error:', err);

    return res.status(500).send(
      'Server error updating status'
    );
  }
};

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function renderBrandedOrderPage({ title, eyebrow, heading, intro, message, orderId, icon }) {
  const siteUrl = (process.env.PUBLIC_SITE_URL
    || process.env.FRONTEND_URL?.split(',')[0].trim()
    || 'http://localhost:3000').replace(/\/+$/, '');
  const safeTitle = escapeHtml(title);
  const safeEyebrow = escapeHtml(eyebrow);
  const safeHeading = escapeHtml(heading);
  const safeIntro = escapeHtml(intro);
  const safeMessage = escapeHtml(message);
  const safeOrderId = escapeHtml(orderId);
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="theme-color" content="#F3EFE9" />
  <title>${safeTitle}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; background: #F3EFE9; color: #1A1512; font-family: Arial, Helvetica, sans-serif; }
    .page { min-height: 100vh; padding: 32px 14px; display: flex; align-items: center; justify-content: center; }
    .card { width: 100%; max-width: 600px; background: #fff; border: 1px solid #E5DED5; box-shadow: 0 12px 36px rgba(26, 21, 18, .10); }
    .brand { padding: 30px 20px; text-align: center; background: #1A1512; color: #F3EFE9; }
    .brand-name { margin: 0; font-size: 29px; line-height: 36px; font-weight: 800; letter-spacing: 6px; }
    .brand-tagline { margin: 8px 0 0; color: #C9BDB0; font-size: 10px; line-height: 16px; letter-spacing: 3px; }
    .banner { padding: 26px 20px; text-align: center; background: #E8E2D9; }
    .icon { margin: 0 0 8px; color: #6F4E37; font-size: 32px; line-height: 38px; }
    .eyebrow { margin: 0 0 8px; color: #6F4E37; font-size: 10px; line-height: 16px; font-weight: 700; letter-spacing: 2px; }
    h1 { margin: 0; color: #1A1512; font-size: 25px; line-height: 33px; }
    .content { padding: 28px 24px 30px; text-align: center; }
    .intro { margin: 0; color: #1A1512; font-size: 15px; line-height: 24px; }
    .message { max-width: 460px; margin: 10px auto 0; color: #6D6259; font-size: 14px; line-height: 23px; }
    .order { display: inline-block; margin-top: 22px; padding: 10px 16px; border: 1px solid #E5DED5; background: #F3EFE9; color: #1A1512; font-size: 12px; line-height: 18px; font-weight: 700; overflow-wrap: anywhere; }
    .actions { margin-top: 24px; }
    .button { display: inline-block; padding: 12px 22px; background: #1A1512; color: #F3EFE9 !important; text-decoration: none; font-size: 11px; line-height: 16px; font-weight: 700; letter-spacing: 1px; }
    .footer { padding: 20px 16px; text-align: center; background: #1A1512; color: #C9BDB0; font-size: 10px; line-height: 16px; letter-spacing: 1px; }
    @media (max-width: 480px) { .page { padding: 18px 10px; } .brand { padding: 25px 16px; } .banner { padding: 23px 16px; } .content { padding: 24px 18px; } h1 { font-size: 22px; line-height: 29px; } }
  </style>
</head>
<body>
  <main class="page">
    <article class="card">
      <header class="brand">
        <p class="brand-name">VEXORA</p>
        <p class="brand-tagline">STREETWEAR. MODEST LUXURY.</p>
      </header>
      <section class="banner">
        <p class="icon" aria-hidden="true">${icon}</p>
        <p class="eyebrow">${safeEyebrow}</p>
        <h1>${safeHeading}</h1>
      </section>
      <section class="content">
        <p class="intro">${safeIntro}</p>
        <p class="message">${safeMessage}</p>
        <div class="order">ORDER #${safeOrderId}</div>
        <div class="actions"><a class="button" href="${escapeHtml(siteUrl)}/shop">CONTINUE SHOPPING</a></div>
      </section>
      <footer class="footer">WEAR YOUR STATEMENT. &nbsp; | &nbsp; VEXORA &nbsp; | &nbsp; ${year}</footer>
    </article>
  </main>
</body>
</html>`;
}
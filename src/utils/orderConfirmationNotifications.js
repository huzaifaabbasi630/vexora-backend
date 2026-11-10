const Order = require('../models/Order');
const { sendEmailConfirmation } = require('./orderConfirmationEmail');
const { formatPhoneNumber, sendWhatsAppText } = require('./whatsapp');

async function sendOrderConfirmationNotifications(order) {
  const { customerInfo = {}, cartItems = [], total = 0 } = order;
  const name = customerInfo.name || 'Customer';
  const email = customerInfo.email || '';
  const phone = customerInfo.phone || '';
  const orderId = String(order._id);
  const shortOrderId = orderId.slice(-6);
  const notifications = order.confirmationNotifications || {};
  let emailSent = Boolean(notifications.emailSentAt);
  let whatsappSent = Boolean(notifications.customerWhatsAppSentAt);
  let emailFailed = false;
  let whatsappFailed = false;

  await Promise.allSettled([
    (async () => {
      if (emailSent) return;
      if (!email) {
        emailFailed = true;
        console.warn(`⚠️ Confirmation email skipped for order #${orderId}: customer email is missing.`);
        return;
      }

      try {
        const result = await sendEmailConfirmation(order);
        const accepted = result.accepted?.some((recipient) =>
          String(recipient).toLowerCase() === email.toLowerCase()
        );
        const rejected = result.rejected?.some((recipient) =>
          String(recipient).toLowerCase() === email.toLowerCase()
        );
        if (rejected || !accepted) {
          throw new Error('Mail provider did not accept the order confirmation email recipient.');
        }

        await Order.updateOne(
          { _id: order._id },
          { $set: { 'confirmationNotifications.emailSentAt': new Date() } }
        );
        emailSent = true;
      } catch (error) {
        emailFailed = true;
        console.error('Order confirmation email failed:', {
          message: error.message,
          code: error.code || null,
          command: error.command || null,
          responseCode: error.responseCode || null,
        });
      }
    })(),
    (async () => {
      if (whatsappSent) return;
      if (!phone) {
        whatsappFailed = true;
        console.warn(`⚠️ Confirmation WhatsApp skipped for order #${orderId}: customer phone is missing.`);
        return;
      }

      const itemLines = cartItems.map((item, index) => {
        const variants = [
          item.selectedSize && `Size: ${item.selectedSize}`,
          item.selectedColor && `Color: ${item.selectedColor}`,
        ].filter(Boolean);
        const variantText = variants.length ? ` (${variants.join(', ')})` : '';
        const quantity = Number(item.qty) || 0;
        const price = Number(item.price) || 0;
        return `${index + 1}. *${item.name || 'Item'}*${variantText}\n   Qty: ${quantity} — RS ${(price * quantity).toLocaleString()}`;
      });
      const message = [
        `🎉 *Your order is confirmed!* (#${shortOrderId})`,
        '',
        `Thank you ${name}! Your order has been confirmed.`,
        '',
        '*Order details:*',
        ...itemLines,
        '',
        `*Total:* RS ${Number(total).toLocaleString()}`,
        `*Delivery address:* ${customerInfo.address || 'Not provided'}`,
        `*Phone:* ${phone}`,
        `*Email:* ${email || 'Not provided'}`,
        '',
        'We will notify you when your order is dispatched.',
        '— Team VEXORA',
      ].join('\n');

      try {
        await sendWhatsAppText(formatPhoneNumber(phone), message);
        await Order.updateOne(
          { _id: order._id },
          { $set: { 'confirmationNotifications.customerWhatsAppSentAt': new Date() } }
        );
        whatsappSent = true;
      } catch (error) {
        whatsappFailed = true;
        console.error('Order confirmation WhatsApp failed:', error.response?.data || error.message);
      }
    })(),
  ]);

  return { emailSent, whatsappSent, emailFailed, whatsappFailed };
}

module.exports = { sendOrderConfirmationNotifications };

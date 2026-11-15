const Order = require('../models/Order');
const { sendEmailConfirmation } = require('./orderConfirmationEmail');
const { formatPhoneNumber, sendWhatsAppText } = require('./whatsapp');

function getSafeFailure(error, channel) {
  const providerError = error.response?.data?.error || {};
  const code = providerError.code || error.code || error.response?.status;
  const detail = providerError.message || error.message || 'Unknown provider error.';
  const safeDetail = String(detail)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .slice(0, 180);
  return {
    code: code ? `${channel}_${code}` : `${channel}_FAILED`,
    message: safeDetail,
  };
}

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
  let emailError = null;
  let whatsappError = null;

  await Promise.allSettled([
    (async () => {
      if (emailSent) return;
      if (!email) {
        emailFailed = true;
        emailError = { code: 'EMAIL_MISSING', message: 'Customer email address is missing.' };
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
        emailError = getSafeFailure(error, 'EMAIL');
        console.error('Order confirmation email failed:', {
          message: emailError.message,
          code: emailError.code,
          command: error.command || null,
          responseCode: error.responseCode || null,
        });
      }
    })(),
    (async () => {
      if (whatsappSent) return;
      if (!phone) {
        whatsappFailed = true;
        whatsappError = { code: 'WHATSAPP_PHONE_MISSING', message: 'Customer phone number is missing.' };
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
        whatsappError = getSafeFailure(error, 'WHATSAPP');
        console.error('Order confirmation WhatsApp failed:', whatsappError);
      }
    })(),
  ]);

  return { emailSent, whatsappSent, emailFailed, whatsappFailed, emailError, whatsappError };
}

module.exports = { sendOrderConfirmationNotifications };

const Order = require('../models/Order');
const { sendOrderStatusEmail } = require('./orderStatusEmail');
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

async function sendOrderStatusNotifications(order, status) {
  const statusKey = status === 'Dispatched' ? 'dispatched' : 'onTheWay';
  const emailSentAtKey = `${statusKey}EmailSentAt`;
  const whatsappSentAtKey = `${statusKey}WhatsAppSentAt`;
  const { email, phone, name } = order.customerInfo || {};

  let emailSent = Boolean(order.statusNotifications?.[emailSentAtKey]);
  let whatsappSent = Boolean(order.statusNotifications?.[whatsappSentAtKey]);
  let emailFailed = false;
  let whatsappFailed = false;
  let emailError = null;
  let whatsappError = null;

  await Promise.allSettled([
    (async () => {
      if (emailSent) {
        console.log(`ℹ️ "${status}" email already sent for order #${order._id}; skipping.`);
        return;
      }
      if (!email) {
        emailFailed = true;
        emailError = { code: 'EMAIL_MISSING', message: 'Customer email address is missing.' };
        console.warn(`⚠️ No email in customerInfo for order #${order._id} — skipping email.`);
        return;
      }

      try {
        const result = await sendOrderStatusEmail(order, status);
        const accepted = result.accepted?.some((recipient) =>
          String(recipient).toLowerCase() === email.toLowerCase()
        );
        const rejected = result.rejected?.some((recipient) =>
          String(recipient).toLowerCase() === email.toLowerCase()
        );
        if (rejected || !accepted) {
          throw new Error(`Mail provider did not accept the ${status} email recipient.`);
        }
        await Order.updateOne(
          { _id: order._id },
          { $set: { [`statusNotifications.${emailSentAtKey}`]: new Date() } }
        );
        emailSent = true;
        console.log(`✅ "${status}" email accepted by mail provider.`);
      } catch (error) {
        emailFailed = true;
        emailError = getSafeFailure(error, 'EMAIL');
        console.error('❌ Order status email error:', {
          message: emailError.message,
          code: emailError.code,
          command: error.command || null,
          responseCode: error.responseCode || null,
        });
      }
    })(),
    (async () => {
      if (whatsappSent) {
        console.log(`ℹ️ "${status}" WhatsApp already sent for order #${order._id}; skipping.`);
        return;
      }
      if (!phone) {
        whatsappFailed = true;
        whatsappError = { code: 'WHATSAPP_PHONE_MISSING', message: 'Customer phone number is missing.' };
        console.warn(`⚠️ No phone in customerInfo for order #${order._id} — skipping WhatsApp.`);
        return;
      }

      try {
        const formattedPhone = formatPhoneNumber(phone);
        const orderShortId = String(order._id).slice(-6);
        const itemLines = (order.cartItems || []).map((item, index) => {
          const variants = [
            item.selectedSize && `Size: ${item.selectedSize}`,
            item.selectedColor && `Color: ${item.selectedColor}`,
          ].filter(Boolean);
          const variantText = variants.length ? ` (${variants.join(', ')})` : '';
          return `${index + 1}. ${item.name}${variantText} x${item.qty} — RS ${(Number(item.price) * Number(item.qty)).toLocaleString()}`;
        });
        const statusMessage = [
          '🚚 *Order Update!*',
          '',
          `Dear ${name || 'Customer'}, your order #${orderShortId} is now *${status}*.`,
          '',
          '*Order details:*',
          ...itemLines,
          '',
          `*Total:* RS ${Number(order.total || 0).toLocaleString()}`,
          `*Delivery address:* ${order.customerInfo?.address || 'Not provided'}`,
          `*Phone:* ${phone}`,
          `*Email:* ${email || 'Not provided'}`,
          '',
          status === 'Dispatched'
            ? 'Your order has been dispatched. Tracking details will be shared.'
            : 'Your order is on the way and will arrive soon.',
        ].join('\n');

        await sendWhatsAppText(formattedPhone, statusMessage);
        await Order.updateOne(
          { _id: order._id },
          { $set: { [`statusNotifications.${whatsappSentAtKey}`]: new Date() } }
        );
        whatsappSent = true;
        console.log(`✅ "${status}" WhatsApp request accepted for customer ending in ${formattedPhone.slice(-4)}.`);
      } catch (error) {
        whatsappFailed = true;
        whatsappError = getSafeFailure(error, 'WHATSAPP');
        console.error('❌ Order status WhatsApp error:', whatsappError);
      }
    })(),
  ]);

  return { emailSent, whatsappSent, emailFailed, whatsappFailed, emailError, whatsappError };
}

module.exports = { sendOrderStatusNotifications };

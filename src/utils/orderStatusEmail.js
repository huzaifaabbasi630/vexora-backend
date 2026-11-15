const { sendEmail } = require('./email');

const currency = (amount) => `RS ${Number(amount || 0).toLocaleString('en-PK')}`;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function buildOrderSummaryHtml(items) {
  const rows = items.map((item) => {
    const quantity = Number(item.qty) || 0;
    const price = Number(item.price) || 0;

    return `
      <tr>
        <td style="padding:12px;border-bottom:1px solid #E5DED5;color:#1A1512;">${escapeHtml(item.name || 'Item')}${item.selectedSize || item.selectedColor ? `<br><span style="font-size:11px;color:#6F4E37;">${item.selectedSize ? `Size: ${escapeHtml(item.selectedSize)}` : ''}${item.selectedSize && item.selectedColor ? ' · ' : ''}${item.selectedColor ? `Color: ${escapeHtml(item.selectedColor)}` : ''}</span>` : ''}</td>
        <td style="padding:12px;border-bottom:1px solid #E5DED5;text-align:center;color:#1A1512;">${quantity}</td>
        <td style="padding:12px;border-bottom:1px solid #E5DED5;text-align:right;color:#1A1512;">${currency(price)}</td>
        <td style="padding:12px;border-bottom:1px solid #E5DED5;text-align:right;color:#1A1512;">${currency(price * quantity)}</td>
      </tr>`;
  }).join('');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:12px;">
      <thead>
        <tr style="background-color:#F3EFE9;color:#1A1512;">
          <th align="left" style="padding:12px;">Item</th>
          <th align="center" style="padding:12px;">Qty</th>
          <th align="right" style="padding:12px;">Price</th>
          <th align="right" style="padding:12px;">Subtotal</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function sendOrderStatusEmail(order, status) {
  const customer = order.customerInfo || {};
  const items = Array.isArray(order.cartItems) ? order.cartItems : [];
  const subtotal = items.reduce(
    (sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 0),
    0
  );
  const total = Number(order.total) || subtotal;
  const shippingCharges = Math.max(total - subtotal, 0);
  const discount = Math.max(subtotal - total, 0);
  const date = new Date().toLocaleDateString('en-PK', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const templateName = status === 'Dispatched' ? 'dispatched' : 'ontheway';
  const subject = status === 'Dispatched'
    ? 'Your VEXORA order has been dispatched'
    : 'Your VEXORA order is on the way';

  if (!customer.email) {
    throw new Error(`Cannot send ${status} email: order has no customer email.`);
  }

  const supportEmail = process.env.SUPPORT_EMAIL || process.env.EMAIL_USER || '';
  return sendEmail(customer.email, subject, templateName, {
    name: customer.name || 'Customer',
    phone: customer.phone || 'Not provided',
    email: customer.email,
    address: customer.address || 'Not provided',
    orderId: String(order._id),
    date,
    year: String(new Date().getFullYear()),
    orderSummaryHtml: buildOrderSummaryHtml(items),
    subtotal: currency(subtotal),
    shippingCharges: currency(shippingCharges),
    discount: currency(discount),
    orderTotal: currency(total),
    estimatedDelivery: 'To be confirmed',
    estimatedDeliveryWindow: 'We will update you when delivery timing is available.',
    estimatedTime: 'To be confirmed',
    deliveryInstructions: 'None provided',
    supportUrl: supportEmail ? `mailto:${supportEmail}` : 'mailto:',
    supportEmail: supportEmail || 'Reply to this email',
  });
}

module.exports = { sendOrderStatusEmail };

const { sendEmail } = require('./email');

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

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

async function sendEmailConfirmation(order) {
  const { customerInfo, cartItems, total, _id } = order;
  const { name, phone, address, email } = customerInfo;

  const orderSummaryHtml = buildOrderSummaryHtml(cartItems, total);

  const orderDate = new Date().toLocaleDateString('en-PK', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Order Confirmed - VEXORA</title>
</head>

<body style="margin:0;padding:0;background-color:#F3EFE9;font-family:Arial,Helvetica,sans-serif;color:#1A1512;">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="width:100%;background-color:#F3EFE9;">
    <tr>
      <td align="center" style="padding:30px 12px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
          style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid #E5DED5;">

          <!-- Brand Header -->
          <tr>
            <td align="center" style="background-color:#1A1512;padding:32px 24px;">
              <p style="margin:0;color:#F3EFE9;font-size:30px;line-height:36px;font-weight:800;letter-spacing:6px;">
                VEXORA
              </p>

              <p style="margin:10px 0 0;color:#C9BDB0;font-size:10px;line-height:16px;letter-spacing:3px;">
                STREETWEAR. MODEST LUXURY.
              </p>
            </td>
          </tr>

          <!-- Confirmation Status -->
          <tr>
            <td align="center" style="background-color:#E8E2D9;padding:22px 20px;">
              <p style="margin:0 0 7px;color:#1A1512;font-size:11px;line-height:16px;font-weight:bold;letter-spacing:2px;">
                ORDER CONFIRMED
              </p>

              <h1 style="margin:0;color:#1A1512;font-size:24px;line-height:32px;">
                Thank You! Your Order is Confirmed
              </h1>

              <p style="margin:8px 0 0;color:#6D6259;font-size:13px;line-height:20px;">
                We are preparing your items and will notify you when they are dispatched.
              </p>
            </td>
          </tr>

          <!-- Main Message -->
          <tr>
            <td style="padding:30px 28px 10px;">
              <p style="margin:0 0 10px;color:#1A1512;font-size:15px;line-height:24px;">
                Hi <strong>${escapeHtml(name)}</strong>,
              </p>

              <p style="margin:0;color:#6D6259;font-size:14px;line-height:24px;">
                Your order has been successfully confirmed via WhatsApp. We're now processing your order and will keep you updated on its progress.
              </p>
            </td>
          </tr>

          <!-- Order Information -->
          <tr>
            <td style="padding:20px 28px 8px;">

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background-color:#F3EFE9;border:1px solid #E5DED5;">

                <tr>
                  <td style="padding:15px;">
                    <p style="margin:0 0 5px;color:#75685D;font-size:10px;line-height:16px;letter-spacing:1.5px;">
                      ORDER NUMBER
                    </p>

                    <p style="margin:0;color:#1A1512;font-size:14px;line-height:20px;font-weight:bold;">
                      #${_id}
                    </p>
                  </td>

                  <td align="right" style="padding:15px;">
                    <p style="margin:0 0 5px;color:#75685D;font-size:10px;line-height:16px;letter-spacing:1.5px;">
                      ORDER DATE
                    </p>

                    <p style="margin:0;color:#1A1512;font-size:12px;line-height:20px;">
                      ${orderDate}
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Product Summary -->
          <tr>
            <td style="padding:20px 28px 8px;">

              <h2 style="margin:0 0 8px;color:#1A1512;font-size:17px;line-height:24px;">
                Your Order Summary
              </h2>

              <p style="margin:0;color:#75685D;font-size:12px;line-height:19px;">
                Please review your items and total below.
              </p>

              ${orderSummaryHtml}

            </td>
          </tr>

          <!-- Delivery Details -->
          <tr>
            <td style="padding:10px 28px 8px;">

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="border:1px solid #E5DED5;">

                <tr>
                  <td style="padding:18px;">

                    <p style="margin:0 0 12px;color:#1A1512;font-size:14px;line-height:20px;font-weight:bold;">
                      Delivery Details
                    </p>

                    <p style="margin:0 0 5px;color:#1A1512;font-size:13px;line-height:20px;font-weight:bold;">
                      ${escapeHtml(name)}
                    </p>

                    <p style="margin:0 0 10px;color:#6D6259;font-size:12px;line-height:21px;">
                      ${escapeHtml(address)}
                    </p>

                    <p style="margin:0;color:#6D6259;font-size:12px;line-height:20px;">
                      Phone: ${escapeHtml(phone)}
                    </p>

                    <p style="margin:4px 0 0;color:#6D6259;font-size:12px;line-height:20px;">
                      Email: ${escapeHtml(email)}
                    </p>

                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="background-color:#1A1512;padding:25px 20px;">

              <p style="margin:0;color:#F3EFE9;font-size:19px;line-height:26px;font-weight:bold;letter-spacing:4px;">
                VEXORA
              </p>

              <p style="margin:8px 0 14px;color:#C9BDB0;font-size:10px;line-height:17px;letter-spacing:1px;">
                WEAR YOUR STATEMENT.
              </p>

              <p style="margin:0;color:#A99B8E;font-size:10px;line-height:18px;">
                &copy; ${new Date().getFullYear()} VEXORA. All rights reserved.
              </p>

              <p style="margin:4px 0 0;color:#A99B8E;font-size:10px;line-height:18px;">
                Thank you for shopping with us.
              </p>

            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;

  return sendEmail(
    email,
    '✅ Your VEXORA Order is Confirmed',
    null,
    { html: emailHtml }
  );
}

module.exports = { sendEmailConfirmation };

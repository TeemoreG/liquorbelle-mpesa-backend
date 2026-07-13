const axios = require('axios');
const { escapeHtml } = require('../config/constants');

const BREVO_API_KEY = process.env.BREVO_API_KEY;

async function sendMpesaOrderReceivedEmail(orderData) {
  if (!BREVO_API_KEY) return;

  const { orderId, customerName, items, subtotal, delivery, total, address, phone, customerEmail, paymentMethod } = orderData;
  const deliveryText = delivery === 0 ? 'FREE' : `KES ${delivery.toLocaleString()}`;
  const isPod = paymentMethod && paymentMethod.toLowerCase() === 'pod';

  const subject = isPod
    ? `Order Received - ${orderId} - LiquorBelle`
    : `Payment Received - ${orderId} - LiquorBelle`;

  const headerBadge = isPod
    ? 'ORDER RECEIVED - RIDER ON THE WAY'
    : 'PAYMENT RECEIVED - ORDER ON THE WAY';

  const headerColor = isPod ? '#f0a500' : '#2ecc71';

  const messageHtml = isPod ? `
    <p style="color:#888;font-size:14px;">Your order has been received! Our rider is on the way to deliver your drinks.</p>
    <p style="color:#888;font-size:14px;margin-top:12px;">The rider will call <strong style="color:#f0a500;">${escapeHtml(phone)}</strong> when approaching your location.</p>
    <p style="color:#f0a500;font-size:15px;font-weight:800;margin-top:12px;">Please have the exact cash ready upon delivery.</p>
  ` : `
    <p style="color:#888;font-size:14px;">Your M-PESA payment of <strong style="color:#2ecc71;">KES ${total.toLocaleString()}</strong> has been received!</p>
    <p style="color:#888;font-size:14px;margin-top:12px;">Your order is now being prepared. Our rider is on the way to deliver your drinks.</p>
    <p style="color:#888;font-size:14px;">The rider will call <strong style="color:#f0a500;">${escapeHtml(phone)}</strong> when approaching your location.</p>
  `;

  const totalLabel = isPod ? 'TOTAL TO PAY' : 'TOTAL PAID';
  const totalColor = isPod ? '#f0a500' : '#2ecc71';

  const itemsHtml = (items || []).map(item => {
    const productName = item.product_name || item.name || 'Product';
    const productQty = item.quantity || item.qty || 1;
    const productPrice = item.price || 0;
    const productSize = item.size || '750ml';
    return `
      <tr style="border-bottom:1px solid #1c1c28;">
        <td style="padding:12px 0;">
          <span style="color:#e0e0e0;">${escapeHtml(productName)} x${productQty}</span><br>
          <span style="color:#555;font-size:11px;">${escapeHtml(productSize)}</span>
        </td>
        <td style="padding:12px 0;text-align:right;color:#f0a500;">KES ${(productPrice * productQty).toLocaleString()}</td>
      </tr>
    `;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:Arial,sans-serif;">
<div style="max-width:580px;margin:0 auto;padding:20px;">
<div style="background:#111118;border-radius:24px;overflow:hidden;border:1px solid #1e1e2c;">
  <div style="height:3px;background:linear-gradient(90deg,#2ecc71,#f0a500,#2ecc71);"></div>
  <div style="background:#071a0f;text-align:center;padding:32px 24px;">
    <img src="https://res.cloudinary.com/dvqjgbdhp/image/upload/v1780905905/WhatsApp_Image_2026-06-04_at_3.41.50_PM_saprsh.jpg" alt="LiquorBelle" style="width:60px;border-radius:16px;margin-bottom:12px;">
    <div style="font-size:26px;font-weight:900;color:#fff;">Liquor<span style="color:#2ecc71;">Belle</span></div>
    <div style="color:#666;font-size:11px;">Dagoretti's Finest · 24/7 Delivery</div>
  </div>
  <div style="text-align:center;padding:20px 24px 0;">
    <span style="background:rgba(${isPod ? '240,165,0' : '46,204,113'},0.12);color:${headerColor};padding:8px 20px;border-radius:50px;font-size:11px;font-weight:800;">${headerBadge}</span>
  </div>
  <div style="padding:20px 28px;">
    <h2 style="color:#fff;font-size:18px;">Hello ${escapeHtml(customerName)},</h2>
    ${messageHtml}
  </div>
  <div style="padding:0 28px;">
    <table style="width:100%;background:#16161f;border-radius:16px;overflow:hidden;">
      <tr style="background:#1a1a26;"><td colspan="2" style="padding:12px 16px;color:#f0a500;font-weight:800;">ORDER ITEMS</td></tr>
      ${itemsHtml}
      <tr><td style="padding:12px 16px;color:#777;">Subtotal</td><td style="padding:12px 16px;text-align:right;color:#ccc;">KES ${subtotal.toLocaleString()}</td></tr>
      <tr><td style="padding:12px 16px;color:#777;">Delivery Fee</td><td style="padding:12px 16px;text-align:right;color:#ccc;">${deliveryText}</td></tr>
      <tr style="background:#0a1a0a;"><td style="padding:16px;color:#fff;font-weight:800;">${totalLabel}</td><td style="padding:16px;text-align:right;color:${totalColor};font-size:20px;font-weight:800;">KES ${total.toLocaleString()}</td></tr>
    </table>
  </div>
  <div style="margin:20px 28px;background:#16161f;border-radius:16px;padding:16px;">
    <div style="color:#2ecc71;">DELIVERY ADDRESS</div>
    <div style="color:#ddd;">${escapeHtml(address)}</div>
    <div style="color:#666;margin-top:8px;">${escapeHtml(phone)}</div>
  </div>
  <div style="margin:0 28px 20px;background:rgba(46,204,113,0.08);border-radius:16px;padding:16px;text-align:center;">
    <div style="font-size:28px;">🏍️</div>
    <div style="color:#2ecc71;font-weight:800;">Estimated Delivery: 10-45 minutes</div>
    <div style="color:#666;">Rider will call before arrival</div>
  </div>
  <div style="padding:20px 28px;text-align:center;">
    <a href="https://teemoreg.github.io/liquorbelle/track-orders.html?email=${encodeURIComponent(customerEmail)}" style="background:#e03131;color:#fff;padding:12px 32px;border-radius:50px;text-decoration:none;font-weight:800;">Track Order</a>
  </div>
  <div style="background:#0d0d14;text-align:center;padding:16px;color:#444;">+254 748 894 443 · WhatsApp 24/7</div>
</div>
</div>
</body>
</html>`;

  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'LiquorBelle', email: 'timblax0@gmail.com' },
      to: [{ email: customerEmail }],
      subject: subject,
      htmlContent: html
    }, { headers: { 'api-key': BREVO_API_KEY }, timeout: 10000 });
    console.log(`Email sent to ${customerEmail} (${isPod ? 'POD' : 'M-PESA'})`);
  } catch (err) {
    console.error('Email error:', err.message);
  }
}

async function sendOrderDeliveredEmail(orderData) {
  if (!BREVO_API_KEY) return;

  const { orderId, customerName, items, total, phone, customerEmail } = orderData;

  const itemsHtml = (items || []).map(item => {
    const productName = item.product_name || item.name || item.product || 'Product';
    const quantity = item.quantity || item.qty || 1;
    const productPrice = item.price || item.unit_price || 0;
    return `
      <tr style="border-bottom:1px solid #1c1c28;">
        <td style="padding:6px 0;color:#ddd;">${escapeHtml(productName)} x${quantity}</td>
        <td style="text-align:right;color:#2ecc71;">KES ${(productPrice * quantity).toLocaleString()}</td>
      </tr>
    `;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Order Delivered - ${orderId} - LiquorBelle</title></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:Arial,sans-serif;">
<div style="max-width:580px;margin:0 auto;padding:20px;">
<div style="background:#111118;border-radius:24px;overflow:hidden;border:1px solid #1e1e2c;">
  <div style="height:3px;background:linear-gradient(90deg,#2ecc71,#f0a500,#2ecc71);"></div>
  <div style="background:#071a0f;text-align:center;padding:32px 24px;">
    <img src="https://res.cloudinary.com/dvqjgbdhp/image/upload/v1780905905/WhatsApp_Image_2026-06-04_at_3.41.50_PM_saprsh.jpg" alt="LiquorBelle" style="width:60px;border-radius:16px;margin-bottom:12px;">
    <div style="font-size:26px;font-weight:900;color:#fff;">Liquor<span style="color:#2ecc71;">Belle</span></div>
  </div>
  <div style="text-align:center;padding:20px 24px 0;">
    <span style="background:rgba(46,204,113,0.12);color:#2ecc71;padding:8px 20px;border-radius:50px;font-size:11px;font-weight:800;">ORDER DELIVERED SUCCESSFULLY</span>
  </div>
  <div style="padding:20px 28px;">
    <h2 style="color:#fff;font-size:18px;">Hello ${escapeHtml(customerName)},</h2>
    <p style="color:#888;font-size:14px;">Your order has been successfully delivered! Thank you for choosing LiquorBelle.</p>
    <p style="color:#888;font-size:14px;margin-top:12px;">We hope you enjoy your drinks. Please don't forget to drink responsibly.</p>
  </div>
  <div style="margin:0 28px;background:#16161f;border-radius:16px;padding:16px;">
    <div style="color:#2ecc71;">ORDER #${escapeHtml(orderId)}</div>
    <table style="width:100%;margin-top:12px;">${itemsHtml}</table>
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid #1e1e2c;text-align:right;"><span style="color:#2ecc71;font-size:18px;font-weight:800;">Total: KES ${(total || 0).toLocaleString()}</span></div>
  </div>
  <div style="padding:20px 28px;text-align:center;">
    <a href="https://teemoreg.github.io/liquorbelle/shop.html" style="background:#2ecc71;color:#fff;padding:12px 32px;border-radius:50px;text-decoration:none;font-weight:800;">Shop Again</a>
  </div>
  <div style="background:#0d0d14;text-align:center;padding:16px;color:#444;">+254 748 894 443 · WhatsApp 24/7</div>
</div>
</div>
</body>
</html>`;

  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'LiquorBelle', email: 'timblax0@gmail.com' },
      to: [{ email: customerEmail }],
      subject: `Order Delivered - ${orderId} - LiquorBelle`,
      htmlContent: html
    }, { headers: { 'api-key': BREVO_API_KEY }, timeout: 10000 });
    console.log(`Order delivered email sent to ${customerEmail}`);
  } catch (err) {
    console.error('Email error:', err.message);
  }
}

async function sendOTPEmail(email, otp) {
  if (!BREVO_API_KEY) return false;

  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'LiquorBelle', email: 'timblax0@gmail.com' },
      to: [{ email }],
      subject: 'Your LiquorBelle Verification Code',
      htmlContent: `<div style="text-align:center;padding:40px;font-family:Arial;"><h2 style="color:#2ecc71;">${otp}</h2><p>Your verification code expires in 10 minutes.</p></div>`
    }, { headers: { 'api-key': BREVO_API_KEY }, timeout: 10000 });
    return true;
  } catch (err) {
    console.error('OTP email error:', err.message);
    return false;
  }
}

module.exports = {
  sendMpesaOrderReceivedEmail,
  sendOrderDeliveredEmail,
  sendOTPEmail
};
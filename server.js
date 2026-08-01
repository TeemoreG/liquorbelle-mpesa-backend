// ==================== EMAIL SERVICE (Brevo) ====================
const axios = require('axios');

// ==================== CONFIG ====================
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = 'timblax0@gmail.com';
const SENDER_NAME = 'LiquorBelle';

// ==================== HELPER: Escape HTML ====================
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

// ==================== HELPER: Send Email (FIXED - params only if not empty) ====================
async function sendBrevoEmail(to, subject, htmlContent, params = {}) {
  if (!BREVO_API_KEY) {
    console.warn('⚠️ BREVO_API_KEY not configured - email not sent');
    return { success: false, error: 'API key missing' };
  }

  if (!to) {
    console.error('❌ Missing recipient email');
    return { success: false, error: 'Missing recipient email' };
  }

  try {
    // ✅ Build payload WITHOUT params if empty
    const emailPayload = {
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: Array.isArray(to) ? to.map(t => typeof t === 'string' ? { email: t } : t) : [{ email: to }],
      subject: subject,
      htmlContent: htmlContent
    };

    // ✅ Only add params if they have data
    if (params && Object.keys(params).length > 0) {
      emailPayload.params = params;
    }

    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      emailPayload,
      {
        headers: { 
          'api-key': BREVO_API_KEY, 
          'Content-Type': 'application/json' 
        },
        timeout: 10000
      }
    );

    console.log(`✅ Email sent to ${Array.isArray(to) ? to.map(t => t.email || t).join(', ') : to}`);
    return { success: true, data: response.data };
  } catch (err) {
    console.error('❌ Email error:', err.response?.data?.message || err.message);
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

// ==================== SEND OTP EMAIL ====================
async function sendOTPEmail(email, otp, type = 'verification', name = 'Customer') {
  if (!BREVO_API_KEY) {
    console.warn('⚠️ BREVO_API_KEY not configured - OTP email not sent');
    return { success: false, error: 'API key missing' };
  }

  if (!email || !otp) {
    console.error('❌ Missing email or OTP for OTP email');
    return { success: false, error: 'Missing email or OTP' };
  }

  const typeConfig = {
    register: {
      subject: '🔐 Verify Your LiquorBelle Account',
      title: 'Account Verification',
      color: '#22C55E',
      message: 'Use the code below to verify your LiquorBelle account.'
    },
    reset: {
      subject: '🔑 Reset Your LiquorBelle PIN',
      title: 'PIN Reset Verification',
      color: '#f0a500',
      message: 'Use the code below to reset your LiquorBelle PIN.'
    },
    login: {
      subject: '🔐 Login Verification Code',
      title: 'Login Verification',
      color: '#3498db',
      message: 'Use the code below to verify your login attempt.'
    },
    verification: {
      subject: 'Your LiquorBelle Verification Code',
      title: 'Verification Code',
      color: '#800000',
      message: 'Use the code below to verify your request.'
    }
  };

  const config = typeConfig[type] || typeConfig.verification;

  try {
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${config.subject}</title></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:Arial,sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:20px;">
<div style="background:#111118;border-radius:24px;overflow:hidden;border:1px solid #1e1e2c;">
  <div style="height:3px;background:linear-gradient(90deg,#22C55E,#f0a500,#22C55E);"></div>
  <div style="background:#071a0f;text-align:center;padding:28px 24px;">
    <img src="https://res.cloudinary.com/dvqjgbdhp/image/upload/v1780905905/WhatsApp_Image_2026-06-04_at_3.41.50_PM_saprsh.jpg" alt="LiquorBelle" style="width:56px;border-radius:14px;margin-bottom:10px;">
    <div style="font-size:22px;font-weight:900;color:#fff;">Liquor<span style="color:#22C55E;">Belle</span></div>
  </div>
  <div style="padding:24px 28px;">
    <h2 style="color:#fff;font-size:16px;">Hello ${escapeHtml(name)},</h2>
    <p style="color:#888;font-size:14px;">${config.message}</p>
    <div style="background:rgba(34,197,94,0.06);border:2px solid ${config.color};border-radius:12px;padding:20px;text-align:center;margin:18px 0;">
      <div style="font-size:36px;font-weight:900;color:${config.color};letter-spacing:6px;font-family:monospace;">${otp}</div>
    </div>
    <p style="color:#666;font-size:11px;text-align:center;">⏰ This code expires in 10 minutes</p>
  </div>
  <div style="background:#0d0d14;text-align:center;padding:14px;color:#444;font-size:11px;">
    If you didn't request this, please ignore this email.
  </div>
</div>
</div>
</body>
</html>`;

    const result = await sendBrevoEmail(email, config.subject, html);
    console.log(`✅ OTP email sent to ${email} (${type})`);
    return result;

  } catch (err) {
    console.error('❌ OTP email error:', err.response?.data?.message || err.message);
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

// ==================== SEND ORDER RECEIVED EMAIL ====================
async function sendMpesaOrderReceivedEmail(orderData) {
  if (!BREVO_API_KEY) {
    console.warn('⚠️ BREVO_API_KEY not configured - email not sent');
    return { success: false, error: 'API key missing' };
  }

  if (!orderData || !orderData.customerEmail || orderData.customerEmail.trim() === '') {
    console.warn('⚠️ Skipping email: customerEmail is blank or missing');
    return { success: false, error: 'Missing customer email' };
  }

  try {
    const {
      orderId,
      customerName,
      items,
      subtotal,
      delivery,
      total,
      address,
      phone,
      customerEmail,
      paymentMethod,
      riderName = 'Our Rider'
    } = orderData;

    const deliveryText = delivery === 0 ? 'FREE' : `KES ${(delivery || 0).toLocaleString()}`;
    const isPod = paymentMethod && paymentMethod.toLowerCase() === 'pod';

    const subject = isPod
      ? `📦 Order Received - ${orderId} - LiquorBelle`
      : `✅ Payment Received - ${orderId} - LiquorBelle`;

    const headerBadge = isPod
      ? '📦 ORDER RECEIVED - RIDER ON THE WAY'
      : '✅ PAYMENT CONFIRMED - ORDER ON THE WAY';

    let messageHtml = '';
    if (isPod) {
      messageHtml = `
        <p style="color:#888;font-size:14px;">Your order has been received! Our rider is on the way to deliver your drinks.</p>
        <p style="color:#888;font-size:14px;margin-top:12px;">The rider will call <strong style="color:#f0a500;">${escapeHtml(phone || '')}</strong> when approaching your location.</p>
        <p style="color:#f0a500;font-size:15px;font-weight:800;margin-top:12px;">💰 Please have the exact cash ready upon delivery.</p>
      `;
    } else {
      messageHtml = `
        <p style="color:#888;font-size:14px;">Your M-PESA payment of <strong style="color:#22C55E;">KES ${(total || 0).toLocaleString()}</strong> has been received! 🎉</p>
        <p style="color:#888;font-size:14px;margin-top:12px;">Your order is now being prepared. Our rider is on the way to deliver your drinks.</p>
        <p style="color:#888;font-size:14px;">The rider will call <strong style="color:#f0a500;">${escapeHtml(phone || '')}</strong> when approaching your location.</p>
      `;
    }

    const totalLabel = isPod ? '💰 TOTAL TO PAY' : '✅ TOTAL PAID';

    let itemsHtml = '';
    if (items && items.length > 0) {
      itemsHtml = items.map(item => {
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
    } else {
      itemsHtml = '<tr><td colspan="2" style="padding:12px;color:#666;text-align:center;">No items</td></tr>';
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { margin:0; padding:0; background:#0a0a0f; font-family: 'Inter', -apple-system, Arial, sans-serif; }
    .container { max-width:580px; margin:0 auto; padding:20px; }
    .card { background:#111118; border-radius:24px; overflow:hidden; border:1px solid #1e1e2c; }
    .header-strip { height:4px; background:linear-gradient(90deg, #22C55E, #f0a500, #22C55E); }
    .brand { background:#071a0f; text-align:center; padding:32px 24px; }
    .brand-logo { width:60px; border-radius:16px; margin-bottom:12px; }
    .brand-title { font-size:26px; font-weight:900; color:#fff; }
    .brand-title span { color:#22C55E; }
    .brand-sub { color:#666; font-size:11px; }
    .badge-wrap { text-align:center; padding:20px 24px 0; }
    .badge { display:inline-block; background:rgba(34,197,94,0.12); padding:8px 20px; border-radius:50px; font-size:11px; font-weight:800; color:#22C55E; }
    .badge.pod { color:#f0a500; background:rgba(240,165,0,0.12); }
    .content { padding:20px 28px; }
    .content h2 { color:#fff; font-size:18px; }
    .content p { color:#888; font-size:14px; line-height:1.6; }
    .table-wrap { padding:0 28px; }
    .table { width:100%; background:#16161f; border-radius:16px; overflow:hidden; }
    .table th { background:#1a1a26; padding:12px 16px; color:#f0a500; font-weight:800; text-align:left; }
    .table td { padding:12px 16px; border-bottom:1px solid #1c1c28; }
    .table .row-sub { color:#777; border-bottom:1px solid #1c1c28; }
    .table .row-sub td:last-child { color:#ccc; text-align:right; }
    .table .row-total { background:#0a1a0a; }
    .table .row-total td { color:#fff; font-weight:800; }
    .table .row-total td:last-child { color:#22C55E; font-size:20px; text-align:right; }
    .table .row-total.pod td:last-child { color:#f0a500; }
    .address-box { margin:20px 28px; background:#16161f; border-radius:16px; padding:16px; }
    .address-box .label { color:#22C55E; font-weight:800; }
    .address-box .addr { color:#ddd; margin-top:4px; }
    .address-box .phone { color:#666; margin-top:8px; }
    .delivery-box { margin:0 28px 20px; background:rgba(34,197,94,0.08); border-radius:16px; padding:16px; text-align:center; }
    .delivery-box .icon { font-size:28px; }
    .delivery-box .time { color:#22C55E; font-weight:800; }
    .delivery-box .note { color:#666; }
    .track-btn-wrap { padding:20px 28px; text-align:center; }
    .track-btn { display:inline-block; background:linear-gradient(135deg, #800000, #5C0000); color:#fff; padding:12px 32px; border-radius:50px; text-decoration:none; font-weight:800; }
    .footer { background:#0d0d14; text-align:center; padding:16px; color:#444; font-size:13px; }
    .footer a { color:#22C55E; text-decoration:none; }
    @media (max-width:480px) { .content { padding:16px 18px; } .table-wrap { padding:0 18px; } .address-box { margin:16px 18px; } .delivery-box { margin:0 18px 16px; } }
  </style>
</head>
<body>
<div class="container">
<div class="card">
  <div class="header-strip"></div>
  <div class="brand">
    <img class="brand-logo" src="https://res.cloudinary.com/dvqjgbdhp/image/upload/v1780905905/WhatsApp_Image_2026-06-04_at_3.41.50_PM_saprsh.jpg" alt="LiquorBelle">
    <div class="brand-title">Liquor<span>Belle</span></div>
    <div class="brand-sub">Nairobi's Finest · 24/7 Delivery</div>
  </div>
  <div class="badge-wrap">
    <span class="badge ${isPod ? 'pod' : ''}">${headerBadge}</span>
  </div>
  <div class="content">
    <h2>Hello ${escapeHtml(customerName || 'Customer')},</h2>
    ${messageHtml}
  </div>
  <div class="table-wrap">
    <table class="table">
      <tr><th colspan="2">📋 ORDER ITEMS</th></tr>
      ${itemsHtml}
      <tr class="row-sub"><td>Subtotal</td><td>KES ${(subtotal || 0).toLocaleString()}</td></tr>
      <tr class="row-sub"><td>Delivery Fee</td><td>${deliveryText}</td></tr>
      <tr class="row-total ${isPod ? 'pod' : ''}"><td>${totalLabel}</td><td>KES ${(total || 0).toLocaleString()}</td></tr>
    </table>
  </div>
  <div class="address-box">
    <div class="label">📍 DELIVERY ADDRESS</div>
    <div class="addr">${escapeHtml(address || '')}</div>
    <div class="phone">📱 ${escapeHtml(phone || '')}</div>
  </div>
  <div class="delivery-box">
    <div class="icon">🏍️</div>
    <div class="time">Estimated Delivery: 10-45 minutes</div>
    <div class="note">Rider will call before arrival · ${escapeHtml(riderName)}</div>
  </div>
  <div class="track-btn-wrap">
    <a class="track-btn" href="https://teemoreg.github.io/liquorbelle/track-orders.html?email=${encodeURIComponent(customerEmail)}">🔍 Track Order</a>
  </div>
  <div class="footer">
    📞 +254 748 894 443 · <a href="https://wa.me/254748894443">WhatsApp 24/7</a>
  </div>
</div>
</div>
</body>
</html>`;

    const result = await sendBrevoEmail(customerEmail, subject, html);
    console.log(`✅ Order email sent to ${customerEmail} (${isPod ? 'POD' : 'M-PESA'})`);
    return result;

  } catch (err) {
    console.error('❌ Order email error:', err.message);
    return { success: false, error: err.message };
  }
}

// ==================== SEND PAYMENT CONFIRMATION EMAIL ====================
async function sendPaymentConfirmationEmail(orderData) {
  return await sendMpesaOrderReceivedEmail(orderData);
}

// ==================== SEND ORDER DELIVERED EMAIL ====================
async function sendOrderDeliveredEmail(orderData) {
  if (!BREVO_API_KEY) {
    console.warn('⚠️ BREVO_API_KEY not configured - email not sent');
    return { success: false, error: 'API key missing' };
  }

  if (!orderData || !orderData.customerEmail || orderData.customerEmail.trim() === '') {
    console.warn('⚠️ Skipping delivered email: customerEmail is blank or missing');
    return { success: false, error: 'Missing customer email' };
  }

  try {
    const { 
      orderId, 
      customerName, 
      items, 
      total, 
      subtotal, 
      delivery, 
      phone, 
      customerEmail 
    } = orderData;

    if (!orderId) {
      console.error('❌ Missing required fields for delivered email: orderId missing');
      return { success: false, error: 'Missing order ID' };
    }

    const deliveryText = delivery === 0 ? 'FREE' : `KES ${(delivery || 0).toLocaleString()}`;

    let itemsHtml = '';
    if (items && items.length > 0) {
      itemsHtml = items.map(item => {
        const productName = item.product_name || item.name || 'Product';
        const quantity = item.quantity || item.qty || 1;
        const productPrice = item.price || 0;
        return `
          <tr style="border-bottom:1px solid #1c1c28;">
            <td style="padding:8px 0;color:#ddd;font-size:14px;">${escapeHtml(productName)} x${quantity}</td>
            <td style="padding:8px 0;text-align:right;color:#22C55E;font-size:14px;">KES ${(productPrice * quantity).toLocaleString()}</td>
          </tr>
        `;
      }).join('');
    } else {
      itemsHtml = '<tr><td colspan="2" style="padding:12px;color:#666;text-align:center;">No items</td></tr>';
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>✅ Order Delivered - ${orderId} - LiquorBelle</title>
  <style>
    body { margin:0; padding:0; background:#0a0a0f; font-family: 'Inter', Arial, sans-serif; }
    .container { max-width:580px; margin:0 auto; padding:20px; }
    .card { background:#111118; border-radius:24px; overflow:hidden; border:1px solid #1e1e2c; }
    .header-strip { height:4px; background:linear-gradient(90deg, #22C55E, #f0a500, #22C55E); }
    .brand { background:#071a0f; text-align:center; padding:32px 24px; }
    .brand-logo { width:60px; border-radius:16px; margin-bottom:12px; }
    .brand-title { font-size:26px; font-weight:900; color:#fff; }
    .brand-title span { color:#22C55E; }
    .brand-sub { color:#666; font-size:11px; }
    .badge-wrap { text-align:center; padding:20px 24px 0; }
    .badge { display:inline-block; background:rgba(34,197,94,0.12); color:#22C55E; padding:8px 20px; border-radius:50px; font-size:11px; font-weight:800; }
    .content { padding:20px 28px; }
    .content h2 { color:#fff; font-size:18px; }
    .content p { color:#888; font-size:14px; line-height:1.6; }
    .table-wrap { padding:0 28px; }
    .table { width:100%; background:#16161f; border-radius:16px; overflow:hidden; }
    .table th { background:#1a1a26; padding:12px 16px; color:#f0a500; font-weight:800; text-align:left; font-size:13px; }
    .table td { padding:12px 16px; border-bottom:1px solid #1c1c28; }
    .table .row-sub td { color:#777; }
    .table .row-sub td:last-child { color:#ccc; text-align:right; }
    .table .row-total { background:#0a1a0a; }
    .table .row-total td { color:#fff; font-weight:800; font-size:16px; }
    .table .row-total td:last-child { color:#22C55E; font-size:20px; text-align:right; }
    .delivery-box { margin:20px 28px; background:rgba(34,197,94,0.08); border-radius:16px; padding:16px; text-align:center; }
    .delivery-box .icon { font-size:28px; }
    .delivery-box .text { color:#22C55E; font-weight:800; }
    .delivery-box .note { color:#666; font-size:13px; margin-top:4px; }
    .btn-wrap { padding:20px 28px; text-align:center; }
    .btn { display:inline-block; background:#22C55E; color:#fff; padding:12px 32px; border-radius:50px; text-decoration:none; font-weight:800; }
    .btn:hover { background:#16A34A; }
    .footer { background:#0d0d14; text-align:center; padding:16px; color:#444; font-size:13px; }
    .footer a { color:#22C55E; text-decoration:none; }
    .review-box { margin:0 28px 20px; background:rgba(240,165,0,0.08); border-radius:16px; padding:16px; text-align:center; border:1px solid rgba(240,165,0,0.2); }
    .review-box .text { color:#f0a500; font-size:14px; }
    .review-box .sub { color:#666; font-size:12px; margin-top:4px; }
    .review-btn { display:inline-block; background:#f0a500; color:#fff; padding:8px 24px; border-radius:50px; text-decoration:none; font-weight:700; font-size:13px; margin-top:8px; }
    @media (max-width:480px) { .content { padding:16px 18px; } .table-wrap { padding:0 18px; } .delivery-box { margin:16px 18px; } .review-box { margin:0 18px 16px; } .btn-wrap { padding:16px 18px; } }
  </style>
</head>
<body>
<div class="container">
<div class="card">
  <div class="header-strip"></div>
  <div class="brand">
    <img class="brand-logo" src="https://res.cloudinary.com/dvqjgbdhp/image/upload/v1780905905/WhatsApp_Image_2026-06-04_at_3.41.50_PM_saprsh.jpg" alt="LiquorBelle">
    <div class="brand-title">Liquor<span>Belle</span></div>
    <div class="brand-sub">Nairobi's Finest · 24/7 Delivery</div>
  </div>
  <div class="badge-wrap">
    <span class="badge">✅ ORDER DELIVERED</span>
  </div>
  <div class="content">
    <h2>Hello ${escapeHtml(customerName || 'Customer')},</h2>
    <p>Your order has been <strong style="color:#22C55E;">successfully delivered</strong>! 🎉</p>
    <p style="margin-top:12px;">Thank you for choosing LiquorBelle. We hope you enjoy your drinks!</p>
    <p style="margin-top:8px;color:#666;font-size:13px;">📱 Rider called: ${escapeHtml(phone || 'N/A')}</p>
  </div>
  <div class="table-wrap">
    <table class="table">
      <tr><th colspan="2">📋 ORDER SUMMARY</th></tr>
      ${itemsHtml}
      ${subtotal !== undefined ? `<tr class="row-sub"><td>Subtotal</td><td>KES ${(subtotal || 0).toLocaleString()}</td></tr>` : ''}
      ${delivery !== undefined ? `<tr class="row-sub"><td>Delivery</td><td>${deliveryText}</td></tr>` : ''}
      <tr class="row-total"><td>Total</td><td>KES ${(total || 0).toLocaleString()}</td></tr>
    </table>
  </div>
  <div class="delivery-box">
    <div class="icon">🏍️</div>
    <div class="text">Delivered Successfully!</div>
    <div class="note">Thank you for choosing LiquorBelle · Enjoy responsibly 🍷</div>
  </div>
  <div class="review-box">
    <div class="text">⭐ Enjoyed your order?</div>
    <div class="sub">Share your experience and help others find us</div>
    <a class="review-btn" href="https://www.google.com/maps/place/Dagoretti+Road,+Nairobi" target="_blank">Write a Review</a>
  </div>
  <div class="btn-wrap">
    <a class="btn" href="https://teemoreg.github.io/liquorbelle/shop.html">🛍️ Shop Again</a>
  </div>
  <div class="footer">
    📞 +254 748 894 443 · <a href="https://wa.me/254748894443">WhatsApp 24/7</a>
  </div>
</div>
</div>
</body>
</html>`;

    const result = await sendBrevoEmail(customerEmail, `✅ Order Delivered - ${orderId} - LiquorBelle`, html);
    console.log(`✅ Order delivered email sent to ${customerEmail}`);
    return result;

  } catch (err) {
    console.error('❌ Email error:', err.response?.data?.message || err.message);
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

// ==================== EXPORT ====================
module.exports = {
  sendBrevoEmail,
  sendOTPEmail,
  sendMpesaOrderReceivedEmail,
  sendPaymentConfirmationEmail,
  sendOrderDeliveredEmail
};
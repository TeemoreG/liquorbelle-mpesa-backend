// ==================== EMAIL SERVICE (Brevo) ====================
const axios = require('axios');
const { getDB } = require('../config/database');

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

// ==================== HELPER: Get Product Image from DB ====================
async function getProductImage(productName) {
  try {
    const db = getDB();
    if (!db) return null;

    const product = await db.collection('products').findOne({
      name: { $regex: new RegExp('^' + productName.trim() + '$', 'i') }
    });

    if (product && product.image) {
      return product.image;
    }
    return null;
  } catch (err) {
    console.warn('Could not fetch product image:', err.message);
    return null;
  }
}

// ==================== HELPER: Send Email ====================
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
    const emailPayload = {
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: Array.isArray(to) ? to.map(t => typeof t === 'string' ? { email: t } : t) : [{ email: to }],
      subject: subject,
      htmlContent: htmlContent
    };

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
      color: '#800000',
      message: 'Use the code below to verify your LiquorBelle account.'
    },
    reset: {
      subject: '🔑 Reset Your LiquorBelle PIN',
      title: 'PIN Reset Verification',
      color: '#800000',
      message: 'Use the code below to reset your LiquorBelle PIN.'
    },
    login: {
      subject: '🔐 Login Verification Code',
      title: 'Login Verification',
      color: '#800000',
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
  <div style="height:4px;background:linear-gradient(90deg,#800000,#d4a017,#800000);"></div>
  <div style="background:#071a0f;text-align:center;padding:28px 24px;">
    <img src="https://res.cloudinary.com/dvqjgbdhp/image/upload/v1780905905/WhatsApp_Image_2026-06-04_at_3.41.50_PM_saprsh.jpg" alt="LiquorBelle" style="width:56px;border-radius:14px;margin-bottom:10px;">
    <div style="font-size:22px;font-weight:900;color:#fff;">Liquor<span style="color:#d4a017;">Belle</span></div>
  </div>
  <div style="padding:24px 28px;">
    <h2 style="color:#fff;font-size:16px;">Hello ${escapeHtml(name)},</h2>
    <p style="color:#888;font-size:14px;">${config.message}</p>
    <div style="background:rgba(128,0,0,0.06);border:2px solid ${config.color};border-radius:12px;padding:20px;text-align:center;margin:18px 0;">
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
      vat,
      total,
      address,
      phone,
      customerEmail,
      paymentMethod,
      riderName = 'Our Rider'
    } = orderData;

    const deliveryText = delivery === 0 ? 'FREE' : `KES ${(delivery || 0).toLocaleString()}`;
    const vatText = (vat && vat > 0) ? `KES ${vat.toLocaleString()}` : 'KES 0';
    const isPod = paymentMethod && paymentMethod.toLowerCase() === 'pod';

    const subject = isPod
      ? `📦 Order Received - ${orderId} - LiquorBelle`
      : `✅ Payment Received - ${orderId} - LiquorBelle`;

    const headerBadge = isPod
      ? '📦 ORDER RECEIVED'
      : '✅ PAYMENT CONFIRMED';

    let messageHtml = '';
    if (isPod) {
      messageHtml = `
        <p style="color:#888;font-size:14px;">Your order has been received! Our rider is on the way.</p>
        <p style="color:#888;font-size:14px;margin-top:12px;">Rider will call <strong style="color:#d4a017;">${escapeHtml(phone || '')}</strong> when approaching.</p>
        <p style="color:#d4a017;font-size:15px;font-weight:800;margin-top:12px;">💰 Have exact cash ready upon delivery.</p>
      `;
    } else {
      messageHtml = `
        <p style="color:#888;font-size:14px;">Your M-PESA payment of <strong style="color:#d4a017;">KES ${(total || 0).toLocaleString()}</strong> has been received!</p>
        <p style="color:#888;font-size:14px;margin-top:12px;">Your order is being prepared. Rider is on the way.</p>
        <p style="color:#888;font-size:14px;">Rider will call <strong style="color:#d4a017;">${escapeHtml(phone || '')}</strong> when approaching.</p>
      `;
    }

    const totalLabel = isPod ? '💰 TOTAL TO PAY' : '✅ TOTAL PAID';

    // ============================================================
    // BUILD ITEMS HTML WITH REAL IMAGES FROM DATABASE
    // ============================================================
    let itemsHtml = '';
    if (items && items.length > 0) {
      // Get images for all products in parallel
      const itemsWithImages = await Promise.all(items.map(async (item) => {
        const productName = item.product_name || item.name || 'Product';
        const image = await getProductImage(productName);
        return { ...item, image };
      }));

      itemsHtml = itemsWithImages.map(item => {
        const productName = item.product_name || item.name || 'Product';
        const productQty = item.quantity || item.qty || 1;
        const productPrice = item.price || 0;
        const productSize = item.size || '750ml';
        const productImage = item.image || '';
        
        // Build image HTML - use real image from DB if available
        const imageHtml = productImage 
          ? `<img src="${productImage}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;background:#1a1a26;flex-shrink:0;" onerror="this.style.display='none'">`
          : `<div style="width:44px;height:44px;background:#1a1a26;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span style="color:#555;font-size:18px;">🍾</span></div>`;
        
        return `
          <tr style="border-bottom:1px solid #1c1c28;">
            <td style="padding:12px 0;">
              <div style="display:flex;align-items:center;gap:12px;">
                ${imageHtml}
                <div>
                  <span style="color:#e0e0e0;font-size:14px;font-weight:500;">${escapeHtml(productName)}</span>
                  <span style="color:#555;font-size:11px;display:block;">${escapeHtml(productSize)} × ${productQty}</span>
                </div>
              </div>
            </td>
            <td style="padding:12px 0;text-align:right;color:#d4a017;font-weight:600;">KES ${(productPrice * productQty).toLocaleString()}</td>
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
    *{margin:0;padding:0;box-sizing:border-box;}
    body{margin:0;padding:0;background:#0a0a0f;font-family:'Inter',-apple-system,BlinkMacSystemFont,Arial,sans-serif;-webkit-font-smoothing:antialiased;}
    .container{max-width:580px;margin:0 auto;padding:20px;}
    .card{background:#111118;border-radius:24px;overflow:hidden;border:1px solid #1e1e2c;box-shadow:0 20px 60px rgba(0,0,0,0.5);}
    .header-strip{height:4px;background:linear-gradient(90deg,#800000,#d4a017,#800000);}
    .brand{background:#071a0f;text-align:center;padding:32px 24px 28px;border-bottom:1px solid #1a1a26;}
    .brand-logo{width:60px;border-radius:16px;margin-bottom:12px;border:2px solid rgba(212,160,23,0.2);}
    .brand-title{font-size:26px;font-weight:900;color:#fff;letter-spacing:-0.5px;}
    .brand-title span{color:#d4a017;}
    .brand-sub{color:#666;font-size:11px;margin-top:4px;letter-spacing:0.5px;text-transform:uppercase;}
    .badge-wrap{text-align:center;padding:20px 24px 0;}
    .badge{display:inline-block;padding:8px 20px;border-radius:50px;font-size:11px;font-weight:800;letter-spacing:0.3px;}
    .badge.pod{color:#d4a017;background:rgba(212,160,23,0.12);border:1px solid rgba(212,160,23,0.2);}
    .badge.mpesa{color:#d4a017;background:rgba(212,160,23,0.08);border:1px solid rgba(212,160,23,0.15);}
    .content{padding:20px 28px;}
    .content h2{color:#fff;font-size:17px;font-weight:700;margin-bottom:8px;}
    .content p{color:#888;font-size:14px;line-height:1.7;}
    .content p strong{color:#e0e0e0;}
    .table-wrap{padding:0 28px;}
    .table{width:100%;background:#16161f;border-radius:16px;overflow:hidden;}
    .table th{background:#1a1a26;padding:12px 16px;color:#d4a017;font-weight:800;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;}
    .table td{padding:12px 16px;border-bottom:1px solid #1c1c28;font-size:13px;}
    .table .row-sub{color:#777;border-bottom:1px solid #1c1c28;}
    .table .row-sub td:last-child{color:#aaa;text-align:right;font-weight:500;}
    .table .row-vat{border-bottom:1px solid #1c1c28;}
    .table .row-vat td{color:#666;font-size:12px;}
    .table .row-vat td:last-child{color:#888;text-align:right;}
    .table .row-total{background:#0d0d14;}
    .table .row-total td{color:#fff;font-weight:800;font-size:15px;padding:14px 16px;}
    .table .row-total td:last-child{color:#d4a017;font-size:20px;text-align:right;}
    .address-box{margin:20px 28px;background:#16161f;border-radius:16px;padding:16px 20px;border:1px solid #1c1c28;}
    .address-box .label{color:#d4a017;font-weight:800;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;}
    .address-box .addr{color:#ddd;margin-top:4px;font-size:14px;}
    .address-box .phone{color:#666;margin-top:6px;font-size:13px;}
    .delivery-box{margin:0 28px 20px;background:rgba(212,160,23,0.06);border-radius:16px;padding:16px 20px;text-align:center;border:1px solid rgba(212,160,23,0.1);}
    .delivery-box .icon{font-size:28px;display:block;margin-bottom:4px;}
    .delivery-box .time{color:#d4a017;font-weight:800;font-size:14px;}
    .delivery-box .note{color:#666;font-size:12px;margin-top:4px;}
    .track-btn-wrap{padding:20px 28px;text-align:center;border-top:1px solid #1a1a26;}
    .track-btn{display:inline-block;background:linear-gradient(135deg,#800000,#5C0000);color:#fff;padding:12px 36px;border-radius:50px;text-decoration:none;font-weight:800;font-size:14px;transition:all 0.3s;border:1px solid rgba(255,255,255,0.05);}
    .track-btn:hover{background:linear-gradient(135deg,#990000,#6B0000);transform:translateY(-2px);box-shadow:0 8px 30px rgba(128,0,0,0.3);}
    .footer{background:#0d0d14;text-align:center;padding:16px 20px;color:#444;font-size:12px;border-top:1px solid #1a1a26;}
    .footer a{color:#d4a017;text-decoration:none;}
    .footer a:hover{text-decoration:underline;}
    @media (max-width:480px){
      .content{padding:16px 18px;}
      .table-wrap{padding:0 18px;}
      .address-box{margin:16px 18px;padding:14px 16px;}
      .delivery-box{margin:0 18px 16px;padding:14px 16px;}
      .track-btn-wrap{padding:16px 18px;}
      .brand{padding:24px 16px 20px;}
      .brand-title{font-size:22px;}
      .table td{padding:10px 14px;font-size:12px;}
      .table .row-total td{font-size:13px;padding:12px 14px;}
      .table .row-total td:last-child{font-size:17px;}
      .badge{font-size:10px;padding:6px 16px;}
    }
    @media (max-width:380px){
      .container{padding:10px;}
      .content{padding:12px 14px;}
      .table td{padding:8px 10px;font-size:11px;}
      .address-box{margin:12px 14px;padding:12px 14px;}
      .delivery-box{margin:0 14px 12px;padding:12px 14px;}
      .track-btn-wrap{padding:12px 14px;}
      .track-btn{padding:10px 24px;font-size:12px;}
    }
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
    <span class="badge ${isPod ? 'pod' : 'mpesa'}">${headerBadge}</span>
  </div>
  <div class="content">
    <h2>Hello ${escapeHtml(customerName || 'Customer')},</h2>
    ${messageHtml}
  </div>
  <div class="table-wrap">
    <table class="table">
      <tr><th colspan="2">📋 Order Items</th></tr>
      ${itemsHtml}
      <tr class="row-sub"><td>Subtotal</td><td>KES ${(subtotal || 0).toLocaleString()}</td></tr>
      <tr class="row-sub"><td>Delivery</td><td>${deliveryText}</td></tr>
      <tr class="row-vat"><td>VAT (16%)</td><td>${vatText}</td></tr>
      <tr class="row-total"><td>${totalLabel}</td><td>KES ${(total || 0).toLocaleString()}</td></tr>
    </table>
  </div>
  <div class="address-box">
    <div class="label">📍 Delivery Address</div>
    <div class="addr">${escapeHtml(address || '')}</div>
    <div class="phone">📱 ${escapeHtml(phone || '')}</div>
  </div>
  <div class="delivery-box">
    <span class="icon">🏍️</span>
    <div class="time">10-45 min delivery</div>
    <div class="note">Rider will call before arrival · ${escapeHtml(riderName)}</div>
  </div>
  <div class="track-btn-wrap">
    <a class="track-btn" href="https://teemoreg.github.io/liquorbelle/">🏠 Back to Home</a>
  </div>
  <div class="footer">
    <div>📞 <a href="tel:+254748894443">+254 748 894 443</a> · <a href="https://wa.me/254748894443">WhatsApp</a></div>
    <div style="margin-top:6px;font-size:11px;color:#333;">🍷 Drink Responsibly · Over 18 Only</div>
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
      vat,
      phone, 
      customerEmail 
    } = orderData;

    if (!orderId) {
      console.error('❌ Missing required fields for delivered email: orderId missing');
      return { success: false, error: 'Missing order ID' };
    }

    const deliveryText = delivery === 0 ? 'FREE' : `KES ${(delivery || 0).toLocaleString()}`;
    const vatText = (vat && vat > 0) ? `KES ${vat.toLocaleString()}` : 'KES 0';

    // ============================================================
    // BUILD ITEMS HTML WITH REAL IMAGES FROM DATABASE
    // ============================================================
    let itemsHtml = '';
    if (items && items.length > 0) {
      const itemsWithImages = await Promise.all(items.map(async (item) => {
        const productName = item.product_name || item.name || 'Product';
        const image = await getProductImage(productName);
        return { ...item, image };
      }));

      itemsHtml = itemsWithImages.map(item => {
        const productName = item.product_name || item.name || 'Product';
        const quantity = item.quantity || item.qty || 1;
        const productPrice = item.price || 0;
        const productSize = item.size || '750ml';
        const productImage = item.image || '';
        
        const imageHtml = productImage 
          ? `<img src="${productImage}" style="width:40px;height:40px;object-fit:cover;border-radius:8px;background:#1a1a26;flex-shrink:0;" onerror="this.style.display='none'">`
          : `<div style="width:40px;height:40px;background:#1a1a26;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span style="color:#555;font-size:16px;">🍾</span></div>`;
        
        return `
          <tr style="border-bottom:1px solid #1c1c28;">
            <td style="padding:8px 0;">
              <div style="display:flex;align-items:center;gap:10px;">
                ${imageHtml}
                <div>
                  <span style="color:#ddd;font-size:13px;">${escapeHtml(productName)}</span>
                  <span style="color:#555;font-size:10px;display:block;">${escapeHtml(productSize)} × ${quantity}</span>
                </div>
              </div>
            </td>
            <td style="padding:8px 0;text-align:right;color:#d4a017;font-size:13px;">KES ${(productPrice * quantity).toLocaleString()}</td>
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
    *{margin:0;padding:0;box-sizing:border-box;}
    body{margin:0;padding:0;background:#0a0a0f;font-family:'Inter',-apple-system,BlinkMacSystemFont,Arial,sans-serif;-webkit-font-smoothing:antialiased;}
    .container{max-width:580px;margin:0 auto;padding:20px;}
    .card{background:#111118;border-radius:24px;overflow:hidden;border:1px solid #1e1e2c;box-shadow:0 20px 60px rgba(0,0,0,0.5);}
    .header-strip{height:4px;background:linear-gradient(90deg,#800000,#d4a017,#800000);}
    .brand{background:#071a0f;text-align:center;padding:32px 24px 28px;border-bottom:1px solid #1a1a26;}
    .brand-logo{width:60px;border-radius:16px;margin-bottom:12px;border:2px solid rgba(212,160,23,0.2);}
    .brand-title{font-size:26px;font-weight:900;color:#fff;letter-spacing:-0.5px;}
    .brand-title span{color:#d4a017;}
    .brand-sub{color:#666;font-size:11px;margin-top:4px;letter-spacing:0.5px;text-transform:uppercase;}
    .badge-wrap{text-align:center;padding:20px 24px 0;}
    .badge{display:inline-block;padding:8px 20px;border-radius:50px;font-size:11px;font-weight:800;color:#d4a017;background:rgba(212,160,23,0.08);border:1px solid rgba(212,160,23,0.15);}
    .content{padding:20px 28px;}
    .content h2{color:#fff;font-size:17px;font-weight:700;margin-bottom:8px;}
    .content p{color:#888;font-size:14px;line-height:1.7;}
    .content p strong{color:#e0e0e0;}
    .table-wrap{padding:0 28px;}
    .table{width:100%;background:#16161f;border-radius:16px;overflow:hidden;}
    .table th{background:#1a1a26;padding:12px 16px;color:#d4a017;font-weight:800;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;}
    .table td{padding:12px 16px;border-bottom:1px solid #1c1c28;font-size:13px;}
    .table .row-sub td{color:#777;}
    .table .row-sub td:last-child{color:#aaa;text-align:right;font-weight:500;}
    .table .row-vat td{color:#666;font-size:12px;}
    .table .row-vat td:last-child{color:#888;text-align:right;}
    .table .row-total{background:#0d0d14;}
    .table .row-total td{color:#fff;font-weight:800;font-size:15px;padding:14px 16px;}
    .table .row-total td:last-child{color:#d4a017;font-size:20px;text-align:right;}
    .delivery-box{margin:20px 28px;background:rgba(212,160,23,0.06);border-radius:16px;padding:16px 20px;text-align:center;border:1px solid rgba(212,160,23,0.1);}
    .delivery-box .icon{font-size:28px;display:block;margin-bottom:4px;}
    .delivery-box .text{color:#d4a017;font-weight:800;font-size:14px;}
    .delivery-box .note{color:#666;font-size:12px;margin-top:4px;}
    .review-box{margin:0 28px 20px;background:rgba(212,160,23,0.06);border-radius:16px;padding:16px 20px;text-align:center;border:1px solid rgba(212,160,23,0.1);}
    .review-box .text{color:#d4a017;font-size:14px;font-weight:600;}
    .review-box .sub{color:#666;font-size:12px;margin-top:4px;}
    .review-btn{display:inline-block;background:#d4a017;color:#fff;padding:8px 24px;border-radius:50px;text-decoration:none;font-weight:700;font-size:13px;margin-top:8px;transition:all 0.3s;}
    .review-btn:hover{background:#b8940e;transform:translateY(-2px);}
    .btn-wrap{padding:20px 28px;text-align:center;border-top:1px solid #1a1a26;}
    .btn{display:inline-block;background:linear-gradient(135deg,#800000,#5C0000);color:#fff;padding:12px 36px;border-radius:50px;text-decoration:none;font-weight:800;font-size:14px;transition:all 0.3s;border:1px solid rgba(255,255,255,0.05);}
    .btn:hover{background:linear-gradient(135deg,#990000,#6B0000);transform:translateY(-2px);box-shadow:0 8px 30px rgba(128,0,0,0.3);}
    .footer{background:#0d0d14;text-align:center;padding:16px 20px;color:#444;font-size:12px;border-top:1px solid #1a1a26;}
    .footer a{color:#d4a017;text-decoration:none;}
    @media (max-width:480px){
      .content{padding:16px 18px;}
      .table-wrap{padding:0 18px;}
      .delivery-box{margin:16px 18px;padding:14px 16px;}
      .review-box{margin:0 18px 16px;padding:14px 16px;}
      .btn-wrap{padding:16px 18px;}
      .brand{padding:24px 16px 20px;}
      .brand-title{font-size:22px;}
      .table td{padding:10px 14px;font-size:12px;}
      .table .row-total td{font-size:13px;padding:12px 14px;}
      .table .row-total td:last-child{font-size:17px;}
    }
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
    <p>Your order has been <strong style="color:#d4a017;">successfully delivered</strong>! 🎉</p>
    <p style="margin-top:12px;">Thank you for choosing LiquorBelle. Enjoy your drinks!</p>
    <p style="margin-top:8px;color:#666;font-size:13px;">📱 Rider called: ${escapeHtml(phone || 'N/A')}</p>
  </div>
  <div class="table-wrap">
    <table class="table">
      <tr><th colspan="2">📋 Order Summary</th></tr>
      ${itemsHtml}
      ${subtotal !== undefined ? `<tr class="row-sub"><td>Subtotal</td><td>KES ${(subtotal || 0).toLocaleString()}</td></tr>` : ''}
      ${delivery !== undefined ? `<tr class="row-sub"><td>Delivery</td><td>${deliveryText}</td></tr>` : ''}
      ${vat !== undefined ? `<tr class="row-vat"><td>VAT (16%)</td><td>${vatText}</td></tr>` : ''}
      <tr class="row-total"><td>Total</td><td>KES ${(total || 0).toLocaleString()}</td></tr>
    </table>
  </div>
  <div class="delivery-box">
    <span class="icon">🏍️</span>
    <div class="text">Delivered Successfully!</div>
    <div class="note">Thank you · Enjoy responsibly 🍷</div>
  </div>
  <div class="review-box">
    <div class="text">⭐ Enjoyed your order?</div>
    <div class="sub">Share your experience</div>
    <a class="review-btn" href="https://www.google.com/maps/place/Dagoretti+Road,+Nairobi" target="_blank">Write a Review</a>
  </div>
  <div class="btn-wrap">
    <a class="btn" href="https://teemoreg.github.io/liquorbelle/shop.html">🛍️ Shop Again</a>
  </div>
  <div class="footer">
    <div>📞 <a href="tel:+254748894443">+254 748 894 443</a> · <a href="https://wa.me/254748894443">WhatsApp</a></div>
    <div style="margin-top:6px;font-size:11px;color:#333;">🍷 Drink Responsibly · Over 18 Only</div>
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
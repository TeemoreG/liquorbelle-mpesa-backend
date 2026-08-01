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
      subject: 'Verify Your LiquorBelle Account',
      title: 'Account Verification',
      color: '#800000',
      message: 'Use the code below to verify your LiquorBelle account.'
    },
    reset: {
      subject: 'Reset Your LiquorBelle PIN',
      title: 'PIN Reset Verification',
      color: '#800000',
      message: 'Use the code below to reset your LiquorBelle PIN.'
    },
    login: {
      subject: 'Login Verification Code',
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
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Inter',-apple-system,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:20px;">
<tr><td align="center">
<table width="100%" max-width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.06);">
  <tr><td style="padding:32px 28px 24px;text-align:center;background:#ffffff;border-bottom:1px solid #f0f0f0;">
    <img src="https://res.cloudinary.com/dvqjgbdhp/image/upload/v1780905905/WhatsApp_Image_2026-06-04_at_3.41.50_PM_saprsh.jpg" alt="LiquorBelle" style="width:48px;border-radius:12px;display:block;margin:0 auto 8px;">
    <div style="font-size:20px;font-weight:800;color:#1a1a1a;">Liquor<span style="color:#800000;">Belle</span></div>
    <div style="font-size:11px;color:#888;margin-top:2px;">Nairobi's Finest · 24/7 Delivery</div>
  </td></tr>
  <tr><td style="padding:28px 28px 20px;">
    <h2 style="color:#1a1a1a;font-size:17px;font-weight:700;margin:0 0 6px;">Hello ${escapeHtml(name)},</h2>
    <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 20px;">${config.message}</p>
    <div style="background:#f8f6f4;border:2px solid #800000;border-radius:12px;padding:20px;text-align:center;">
      <div style="font-size:36px;font-weight:900;color:#800000;letter-spacing:6px;font-family:monospace;">${otp}</div>
    </div>
    <p style="color:#999;font-size:11px;text-align:center;margin:16px 0 0;">⏰ This code expires in 10 minutes</p>
  </td></tr>
  <tr><td style="padding:14px 28px;background:#fafafa;text-align:center;color:#999;font-size:11px;border-top:1px solid #f0f0f0;">
    If you didn't request this, please ignore this email.
  </td></tr>
</table>
</td></tr>
</table>
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
        const productQty = item.quantity || item.qty || 1;
        const productPrice = item.price || 0;
        const productSize = item.size || '750ml';
        const productImage = item.image || '';
        
        const imageHtml = productImage 
          ? `<img src="${productImage}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;background:#f5f5f5;flex-shrink:0;" onerror="this.style.display='none'">`
          : `<div style="width:48px;height:48px;background:#f5f5f5;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span style="color:#ccc;font-size:20px;">🍾</span></div>`;
        
        return `
          <tr>
            <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;">
              <div style="display:flex;align-items:center;gap:12px;">
                ${imageHtml}
                <div>
                  <div style="color:#1a1a1a;font-size:14px;font-weight:600;">${escapeHtml(productName)}</div>
                  <div style="color:#888;font-size:12px;">${escapeHtml(productSize)} × ${productQty}</div>
                </div>
              </div>
            </td>
            <td style="padding:12px 0;text-align:right;color:#1a1a1a;font-weight:700;font-size:14px;border-bottom:1px solid #f0f0f0;">KES ${(productPrice * productQty).toLocaleString()}</td>
          </tr>
        `;
      }).join('');
    } else {
      itemsHtml = '<tr><td colspan="2" style="padding:12px;color:#999;text-align:center;">No items</td></tr>';
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Inter',-apple-system,BlinkMacSystemFont,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:20px;">
<tr><td align="center">
<table width="100%" max-width="580" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.06);">

  <!-- HEADER -->
  <tr><td style="padding:28px 28px 20px;text-align:center;background:#ffffff;border-bottom:1px solid #f0f0f0;">
    <img src="https://res.cloudinary.com/dvqjgbdhp/image/upload/v1780905905/WhatsApp_Image_2026-06-04_at_3.41.50_PM_saprsh.jpg" alt="LiquorBelle" style="width:48px;border-radius:12px;display:block;margin:0 auto 8px;">
    <div style="font-size:20px;font-weight:800;color:#1a1a1a;">Liquor<span style="color:#800000;">Belle</span></div>
    <div style="font-size:11px;color:#888;margin-top:2px;">Nairobi's Finest · 24/7 Delivery</div>
  </td></tr>

  <!-- BODY -->
  <tr><td style="padding:28px 28px 8px;">
    <h2 style="color:#1a1a1a;font-size:18px;font-weight:700;margin:0 0 4px;">Thank you for your order, ${escapeHtml(customerName || 'Customer')}!</h2>
    <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 16px;">${isPod ? 'Your order has been received and is being prepared for delivery.' : 'Your payment has been confirmed and your order is being prepared.'}</p>
    
    <!-- Status Steps -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 20px;">
      <tr>
        <td align="center" style="padding:0 2px;">
          <div style="display:inline-block;width:32px;height:32px;border-radius:50%;background:#800000;color:#fff;font-size:14px;font-weight:700;text-align:center;line-height:32px;">✓</div>
          <div style="font-size:10px;color:#800000;font-weight:600;margin-top:4px;">Order</div>
        </td>
        <td style="width:40px;padding:0 4px;">
          <div style="height:2px;background:#800000;"></div>
        </td>
        <td align="center" style="padding:0 2px;">
          <div style="display:inline-block;width:32px;height:32px;border-radius:50%;background:#e0e0e0;color:#999;font-size:14px;font-weight:700;text-align:center;line-height:32px;">●</div>
          <div style="font-size:10px;color:#999;font-weight:600;margin-top:4px;">Preparing</div>
        </td>
        <td style="width:40px;padding:0 4px;">
          <div style="height:2px;background:#e0e0e0;"></div>
        </td>
        <td align="center" style="padding:0 2px;">
          <div style="display:inline-block;width:32px;height:32px;border-radius:50%;background:#e0e0e0;color:#999;font-size:14px;font-weight:700;text-align:center;line-height:32px;">●</div>
          <div style="font-size:10px;color:#999;font-weight:600;margin-top:4px;">Delivered</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- ORDER INFO -->
  <tr><td style="padding:0 28px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6f4;border-radius:10px;padding:12px 16px;">
      <tr>
        <td style="color:#888;font-size:11px;">ORDER NUMBER</td>
        <td style="color:#1a1a1a;font-size:13px;font-weight:700;text-align:right;">${escapeHtml(orderId || 'N/A')}</td>
      </tr>
      <tr>
        <td style="color:#888;font-size:11px;padding-top:4px;">PAYMENT METHOD</td>
        <td style="color:#1a1a1a;font-size:13px;font-weight:600;text-align:right;padding-top:4px;">${isPod ? 'Pay on Delivery' : 'M-PESA'}</td>
      </tr>
      <tr>
        <td style="color:#888;font-size:11px;padding-top:4px;">RIDER CONTACT</td>
        <td style="color:#1a1a1a;font-size:13px;font-weight:600;text-align:right;padding-top:4px;">${escapeHtml(phone || 'N/A')}</td>
      </tr>
    </table>
  </td></tr>

  <!-- ADDRESS -->
  <tr><td style="padding:0 28px 16px;">
    <div style="background:#f8f6f4;border-radius:10px;padding:12px 16px;">
      <div style="color:#888;font-size:11px;">DELIVERY ADDRESS</div>
      <div style="color:#1a1a1a;font-size:13px;font-weight:500;margin-top:4px;">${escapeHtml(address || '')}</div>
      <div style="color:#888;font-size:12px;margin-top:2px;">📱 ${escapeHtml(phone || '')}</div>
    </div>
  </td></tr>

  <!-- PAYMENT SUMMARY -->
  <tr><td style="padding:0 28px 4px;">
    <div style="font-size:15px;font-weight:700;color:#1a1a1a;margin-bottom:12px;">YOUR PAYMENT SUMMARY</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="color:#666;font-size:13px;padding:4px 0;">Subtotal</td><td style="color:#1a1a1a;font-size:13px;text-align:right;padding:4px 0;">KES ${(subtotal || 0).toLocaleString()}</td></tr>
      <tr><td style="color:#666;font-size:13px;padding:4px 0;">Delivery</td><td style="color:#1a1a1a;font-size:13px;text-align:right;padding:4px 0;">${deliveryText}</td></tr>
      <tr><td style="color:#666;font-size:13px;padding:4px 0;">VAT (16%)</td><td style="color:#1a1a1a;font-size:13px;text-align:right;padding:4px 0;">${vatText}</td></tr>
      <tr><td style="border-top:2px solid #1a1a1a;padding:10px 0 4px;font-weight:700;color:#1a1a1a;font-size:15px;">${isPod ? 'TOTAL TO PAY' : 'TOTAL PAID'}</td><td style="border-top:2px solid #1a1a1a;padding:10px 0 4px;font-weight:700;color:#800000;font-size:18px;text-align:right;">KES ${(total || 0).toLocaleString()}</td></tr>
    </table>
  </td></tr>

  <!-- PRODUCTS -->
  <tr><td style="padding:16px 28px 4px;">
    <div style="font-size:15px;font-weight:700;color:#1a1a1a;margin-bottom:12px;">PRODUCT DETAILS</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${itemsHtml}
    </table>
  </td></tr>

  <!-- DELIVERY NOTE -->
  <tr><td style="padding:16px 28px 8px;">
    <div style="background:#f8f6f4;border-radius:10px;padding:14px 16px;text-align:center;">
      <div style="font-size:24px;">🏍️</div>
      <div style="color:#1a1a1a;font-weight:700;font-size:14px;margin-top:4px;">10-45 min delivery</div>
      <div style="color:#888;font-size:12px;margin-top:2px;">Rider will call before arrival · ${escapeHtml(riderName)}</div>
      ${isPod ? `<div style="color:#800000;font-weight:700;font-size:13px;margin-top:8px;">💰 Please have exact cash ready upon delivery</div>` : ''}
    </div>
  </td></tr>

  <!-- BUTTON -->
  <tr><td style="padding:16px 28px 24px;text-align:center;">
    <a href="https://teemoreg.github.io/liquorbelle/" style="display:inline-block;background:#800000;color:#ffffff;padding:12px 40px;border-radius:50px;text-decoration:none;font-weight:700;font-size:14px;border:none;">🏠 Back to Home</a>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="padding:14px 28px;background:#fafafa;text-align:center;color:#999;font-size:11px;border-top:1px solid #f0f0f0;">
    <div>📞 <a href="tel:+254748894443" style="color:#800000;text-decoration:none;">+254 748 894 443</a> · <a href="https://wa.me/254748894443" style="color:#800000;text-decoration:none;">WhatsApp</a></div>
    <div style="margin-top:4px;color:#ccc;">🍷 Drink Responsibly · Over 18 Only</div>
  </td></tr>

</table>
</td></tr>
</table>
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
          ? `<img src="${productImage}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;background:#f5f5f5;flex-shrink:0;" onerror="this.style.display='none'">`
          : `<div style="width:48px;height:48px;background:#f5f5f5;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span style="color:#ccc;font-size:20px;">🍾</span></div>`;
        
        return `
          <tr>
            <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;">
              <div style="display:flex;align-items:center;gap:12px;">
                ${imageHtml}
                <div>
                  <div style="color:#1a1a1a;font-size:14px;font-weight:600;">${escapeHtml(productName)}</div>
                  <div style="color:#888;font-size:12px;">${escapeHtml(productSize)} × ${quantity}</div>
                </div>
              </div>
            </td>
            <td style="padding:12px 0;text-align:right;color:#1a1a1a;font-weight:700;font-size:14px;border-bottom:1px solid #f0f0f0;">KES ${(productPrice * quantity).toLocaleString()}</td>
          </tr>
        `;
      }).join('');
    } else {
      itemsHtml = '<tr><td colspan="2" style="padding:12px;color:#999;text-align:center;">No items</td></tr>';
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>✅ Order Delivered - ${orderId} - LiquorBelle</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Inter',-apple-system,BlinkMacSystemFont,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:20px;">
<tr><td align="center">
<table width="100%" max-width="580" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.06);">

  <!-- HEADER -->
  <tr><td style="padding:28px 28px 20px;text-align:center;background:#ffffff;border-bottom:1px solid #f0f0f0;">
    <img src="https://res.cloudinary.com/dvqjgbdhp/image/upload/v1780905905/WhatsApp_Image_2026-06-04_at_3.41.50_PM_saprsh.jpg" alt="LiquorBelle" style="width:48px;border-radius:12px;display:block;margin:0 auto 8px;">
    <div style="font-size:20px;font-weight:800;color:#1a1a1a;">Liquor<span style="color:#800000;">Belle</span></div>
    <div style="font-size:11px;color:#888;margin-top:2px;">Nairobi's Finest · 24/7 Delivery</div>
  </td></tr>

  <!-- BODY -->
  <tr><td style="padding:28px 28px 8px;">
    <h2 style="color:#1a1a1a;font-size:18px;font-weight:700;margin:0 0 4px;">✅ Order Delivered, ${escapeHtml(customerName || 'Customer')}!</h2>
    <p style="color:#666;font-size:14px;line-height:1.6;margin:0 0 16px;">Your order has been successfully delivered. Thank you for choosing LiquorBelle!</p>
    
    <!-- Status Steps - All Complete -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 20px;">
      <tr>
        <td align="center" style="padding:0 2px;">
          <div style="display:inline-block;width:32px;height:32px;border-radius:50%;background:#800000;color:#fff;font-size:14px;font-weight:700;text-align:center;line-height:32px;">✓</div>
          <div style="font-size:10px;color:#800000;font-weight:600;margin-top:4px;">Order</div>
        </td>
        <td style="width:40px;padding:0 4px;">
          <div style="height:2px;background:#800000;"></div>
        </td>
        <td align="center" style="padding:0 2px;">
          <div style="display:inline-block;width:32px;height:32px;border-radius:50%;background:#800000;color:#fff;font-size:14px;font-weight:700;text-align:center;line-height:32px;">✓</div>
          <div style="font-size:10px;color:#800000;font-weight:600;margin-top:4px;">Prepared</div>
        </td>
        <td style="width:40px;padding:0 4px;">
          <div style="height:2px;background:#800000;"></div>
        </td>
        <td align="center" style="padding:0 2px;">
          <div style="display:inline-block;width:32px;height:32px;border-radius:50%;background:#800000;color:#fff;font-size:14px;font-weight:700;text-align:center;line-height:32px;">✓</div>
          <div style="font-size:10px;color:#800000;font-weight:600;margin-top:4px;">Delivered</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- ORDER INFO -->
  <tr><td style="padding:0 28px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6f4;border-radius:10px;padding:12px 16px;">
      <tr>
        <td style="color:#888;font-size:11px;">ORDER NUMBER</td>
        <td style="color:#1a1a1a;font-size:13px;font-weight:700;text-align:right;">${escapeHtml(orderId || 'N/A')}</td>
      </tr>
      <tr>
        <td style="color:#888;font-size:11px;padding-top:4px;">DELIVERED TO</td>
        <td style="color:#1a1a1a;font-size:13px;font-weight:600;text-align:right;padding-top:4px;">📱 ${escapeHtml(phone || 'N/A')}</td>
      </tr>
    </table>
  </td></tr>

  <!-- PAYMENT SUMMARY -->
  <tr><td style="padding:0 28px 4px;">
    <div style="font-size:15px;font-weight:700;color:#1a1a1a;margin-bottom:12px;">ORDER SUMMARY</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="color:#666;font-size:13px;padding:4px 0;">Subtotal</td><td style="color:#1a1a1a;font-size:13px;text-align:right;padding:4px 0;">KES ${(subtotal || 0).toLocaleString()}</td></tr>
      <tr><td style="color:#666;font-size:13px;padding:4px 0;">Delivery</td><td style="color:#1a1a1a;font-size:13px;text-align:right;padding:4px 0;">${deliveryText}</td></tr>
      <tr><td style="color:#666;font-size:13px;padding:4px 0;">VAT (16%)</td><td style="color:#1a1a1a;font-size:13px;text-align:right;padding:4px 0;">${vatText}</td></tr>
      <tr><td style="border-top:2px solid #1a1a1a;padding:10px 0 4px;font-weight:700;color:#1a1a1a;font-size:15px;">TOTAL PAID</td><td style="border-top:2px solid #1a1a1a;padding:10px 0 4px;font-weight:700;color:#800000;font-size:18px;text-align:right;">KES ${(total || 0).toLocaleString()}</td></tr>
    </table>
  </td></tr>

  <!-- PRODUCTS -->
  <tr><td style="padding:16px 28px 4px;">
    <div style="font-size:15px;font-weight:700;color:#1a1a1a;margin-bottom:12px;">PRODUCT DETAILS</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${itemsHtml}
    </table>
  </td></tr>

  <!-- REVIEW -->
  <tr><td style="padding:16px 28px 8px;">
    <div style="background:#f8f6f4;border-radius:10px;padding:16px 20px;text-align:center;">
      <div style="font-size:24px;">⭐</div>
      <div style="color:#1a1a1a;font-weight:700;font-size:14px;margin-top:4px;">Enjoyed your order?</div>
      <div style="color:#888;font-size:12px;margin-top:2px;">Share your experience with others</div>
      <a href="https://www.google.com/maps/place/Dagoretti+Road,+Nairobi" style="display:inline-block;background:#800000;color:#ffffff;padding:8px 28px;border-radius:50px;text-decoration:none;font-weight:600;font-size:13px;margin-top:10px;border:none;">Write a Review</a>
    </div>
  </td></tr>

  <!-- BUTTON -->
  <tr><td style="padding:16px 28px 24px;text-align:center;">
    <a href="https://teemoreg.github.io/liquorbelle/shop.html" style="display:inline-block;background:#800000;color:#ffffff;padding:12px 40px;border-radius:50px;text-decoration:none;font-weight:700;font-size:14px;border:none;">🛍️ Shop Again</a>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="padding:14px 28px;background:#fafafa;text-align:center;color:#999;font-size:11px;border-top:1px solid #f0f0f0;">
    <div>📞 <a href="tel:+254748894443" style="color:#800000;text-decoration:none;">+254 748 894 443</a> · <a href="https://wa.me/254748894443" style="color:#800000;text-decoration:none;">WhatsApp</a></div>
    <div style="margin-top:4px;color:#ccc;">🍷 Drink Responsibly · Over 18 Only</div>
  </td></tr>

</table>
</td></tr>
</table>
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
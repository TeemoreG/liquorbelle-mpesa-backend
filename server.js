require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { pool, initDB, getAllProducts, updateProduct, createProduct, deleteProduct, getAllOrders, updateOrderStatus, createOrder, getDashboardStats, getOrderById } = require('./db');

// Initialize database on startup
initDB();

const app = express();
app.use(cors());
app.use(express.json());

// ==================== SECURITY & RATE LIMITING ====================
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many OTP requests. Try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const stkLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many payment attempts. Please wait.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', generalLimiter);
app.use('/api/send-email-otp', otpLimiter);
app.use('/api/stkpush', stkLimiter);

// ==================== SAFARICOM DARAJA CREDENTIALS ====================
const CONSUMER_KEY = process.env.CONSUMER_KEY || 'YOUR_CONSUMER_KEY';
const CONSUMER_SECRET = process.env.CONSUMER_SECRET || 'YOUR_CONSUMER_SECRET';
const PASSKEY = process.env.PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
const SHORTCODE = process.env.SHORTCODE || '174379';
const BUSINESS_NUMBER = '254748894443';

const baseURL = 'https://sandbox.safaricom.co.ke';

let accessToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry - 60000) return accessToken;
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res = await axios.get(`${baseURL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` }
  });
  accessToken = res.data.access_token;
  tokenExpiry = Date.now() + (res.data.expires_in * 1000);
  return accessToken;
}

function formatPhone(phone) {
  let cleaned = phone.toString().replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '254' + cleaned.slice(1);
  if (!cleaned.startsWith('254')) cleaned = '254' + cleaned;
  return cleaned;
}

const pendingOrders = new Map();

// ==================== HELPER FUNCTIONS ====================
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// ==================== EMAIL ORDER LOOKUP ====================
app.get('/api/orders/by-email/:email', async (req, res) => {
  try {
    const { email } = req.params;
    if (!email) {
      return res.json({ success: false, message: 'Email required' });
    }
    
    const result = await pool.query(
      `SELECT o.*, 
        COALESCE(
          (SELECT json_agg(row_to_json(oi)) FROM order_items oi WHERE oi.order_id = o.id),
          '[]'::json
        ) as items
       FROM orders o
       WHERE o.customer_email ILIKE $1
       ORDER BY o.created_at DESC`,
      [email]
    );
    
    res.json({ success: true, orders: result.rows });
  } catch (err) {
    console.error('Email order lookup error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== PROFESSIONAL EMAIL TEMPLATE ====================
function generateOrderEmailHtml(orderData, isPaymentConfirmed = false) {
  const {
    orderId,
    customerName,
    items,
    subtotal,
    delivery,
    total,
    address,
    timestamp,
    paymentMethod,
    phone
  } = orderData;

  const itemsRows = items.map(item => `
    <tr style="border-bottom: 1px solid #2a2a35;">
      <td style="padding: 12px 0; color: #e0e0e0; font-size: 14px;">${escapeHtml(item.name)} <span style="color: #888; font-size: 12px;">x${item.qty}</span></td>
      <td style="padding: 12px 0; text-align: right; color: #f0a500; font-weight: 600; font-size: 14px;">KES ${(item.price * item.qty).toLocaleString()}</td>
    </tr>
  `).join('');

  const deliveryText = delivery === 0 ? 'FREE' : `KES ${delivery.toLocaleString()}`;
  const paymentText = paymentMethod === 'mpesa' ? 'M-PESA (STK Push)' : 'Cash on Delivery';
  const formattedPhone = phone ? escapeHtml(phone) : 'Provided at checkout';
  
  const statusColor = isPaymentConfirmed ? '#2ecc71' : '#f0a500';
  const statusText = isPaymentConfirmed ? 'PAYMENT CONFIRMED ✓' : 'ORDER RECEIVED';
  const statusBg = isPaymentConfirmed ? 'rgba(46,204,113,0.12)' : 'rgba(240,165,0,0.12)';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Order ${orderId} - LiquorBelle</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; padding: 20px;">
    <!-- Main Card -->
    <div style="background: linear-gradient(135deg, #111118 0%, #17171f 100%); border-radius: 24px; overflow: hidden; border: 1px solid #2a2a35; box-shadow: 0 8px 24px rgba(0,0,0,0.4);">
      
      <!-- Header with Logo -->
      <div style="text-align: center; padding: 32px 24px 20px; border-bottom: 1px solid #2a2a35;">
        <img src="https://i.postimg.cc/PxwLVrdh/227a55e3-ad16-4893-9e87-03dfc202814f.png" alt="LiquorBelle" style="width: 60px; height: auto; margin-bottom: 12px;">
        <div style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">Liquor<span style="color: #f0a500;">Belle</span></div>
        <div style="font-size: 12px; color: #888; margin-top: 4px;">Dagoretti's Finest • 24/7 Delivery</div>
      </div>
      
      <!-- Status Badge -->
      <div style="text-align: center; padding: 24px 24px 0;">
        <span style="display: inline-block; background: ${statusBg}; color: ${statusColor}; padding: 6px 18px; border-radius: 50px; font-size: 12px; font-weight: 700; letter-spacing: 0.5px;">${statusText}</span>
      </div>
      
      <!-- Greeting -->
      <div style="padding: 20px 24px 0;">
        <h2 style="color: #ffffff; font-size: 20px; font-weight: 600; margin: 0 0 8px;">Hello ${escapeHtml(customerName)},</h2>
        <p style="color: #aaa; font-size: 14px; line-height: 1.5; margin: 0;">
          ${isPaymentConfirmed ? 'Your payment has been confirmed! 🎉' : 'Thank you for your order!'} 
          We're preparing your items for delivery.
        </p>
      </div>
      
      <!-- Order Info Card -->
      <div style="background: #1e1e28; margin: 20px 24px; border-radius: 16px; padding: 16px;">
        <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
          <div>
            <div style="color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Order Number</div>
            <div style="color: #f0a500; font-size: 15px; font-weight: 700;">${orderId}</div>
          </div>
          <div>
            <div style="color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Order Date</div>
            <div style="color: #e0e0e0; font-size: 14px;">${timestamp}</div>
          </div>
          <div>
            <div style="color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Payment</div>
            <div style="color: #e0e0e0; font-size: 14px;">${paymentText}</div>
          </div>
        </div>
      </div>
      
      <!-- Items Table -->
      <div style="margin: 0 24px;">
        <div style="background: #1e1e28; border-radius: 16px; overflow: hidden;">
          <div style="background: #24242f; padding: 12px 16px; font-weight: 600; color: #f0a500; font-size: 13px;">Order Summary</div>
          <table style="width: 100%; border-collapse: collapse; padding: 0 16px;">
            <tbody>
              ${itemsRows}
            </tbody>
          </table>
          <div style="padding: 12px 16px; border-top: 1px solid #2a2a35;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="color: #aaa; font-size: 13px;">Subtotal</span>
              <span style="color: #e0e0e0; font-size: 13px;">KES ${subtotal.toLocaleString()}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
              <span style="color: #aaa; font-size: 13px;">Delivery Fee</span>
              <span style="color: #e0e0e0; font-size: 13px;">${deliveryText}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding-top: 12px; border-top: 2px solid #e03131;">
              <span style="color: #ffffff; font-size: 16px; font-weight: 700;">Total</span>
              <span style="color: #e03131; font-size: 18px; font-weight: 800;">KES ${total.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Delivery Address -->
      <div style="margin: 20px 24px;">
        <div style="background: #1e1e28; border-radius: 16px; padding: 16px;">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
            <span style="font-size: 18px;">📍</span>
            <span style="color: #f0a500; font-weight: 600; font-size: 12px;">DELIVERY ADDRESS</span>
          </div>
          <div style="color: #e0e0e0; font-size: 14px; line-height: 1.4;">${escapeHtml(address)}</div>
          <div style="color: #aaa; font-size: 12px; margin-top: 8px;">📞 Contact: ${formattedPhone}</div>
        </div>
      </div>
      
      <!-- Delivery Progress -->
      <div style="margin: 0 24px 24px;">
        <div style="background: rgba(46,204,113,0.05); border-radius: 16px; padding: 16px; text-align: center; border: 1px solid rgba(46,204,113,0.15);">
          <div style="font-size: 28px; margin-bottom: 8px;">🚚</div>
          <div style="color: #2ecc71; font-weight: 600; font-size: 14px; margin-bottom: 4px;">Delivery in Progress</div>
          <div style="color: #aaa; font-size: 12px;">Our rider will contact you on ${formattedPhone} within 45 minutes</div>
        </div>
      </div>
      
      <!-- Track Button -->
      <div style="text-align: center; padding: 0 24px 24px;">
        <a href="https://teemoreg.github.io/liquorbelle/track-orders.html" style="display: inline-block; background: linear-gradient(135deg, #e03131, #c0392b); color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 50px; font-weight: 600; font-size: 14px;">🔍 Track Your Order</a>
      </div>
      
      <!-- Footer -->
      <div style="text-align: center; padding: 20px 24px; background: #0d0d12; border-top: 1px solid #2a2a35;">
        <p style="color: #666; font-size: 11px; margin: 0 0 8px;">LiquorBelle — Dagoretti Road, Opposite Quickmart</p>
        <p style="color: #555; font-size: 10px; margin: 0;">📞 +254 748 894 443 | 💬 WhatsApp Available 24/7</p>
        <p style="color: #444; font-size: 9px; margin: 12px 0 0;">⚠️ You must be over 18 to purchase alcohol. Drink responsibly.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ==================== SEND ORDER PAID EMAIL ====================
async function sendOrderPaidEmail(orderId, email, customerName, orderNumber, total, address, items, subtotal, delivery, phone, timestamp) {
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) return;
  
  const html = generateOrderEmailHtml({
    orderId: orderNumber,
    customerName,
    items: items || [],
    subtotal: subtotal || 0,
    delivery: delivery || 0,
    total: total,
    address,
    timestamp: timestamp || new Date().toLocaleString('en-KE', { hour12: true, hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }),
    paymentMethod: 'mpesa',
    phone: phone || ''
  }, true);
  
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'LiquorBelle', email: 'timblax0@gmail.com' },
      to: [{ email: email }],
      subject: `✅ Payment Confirmed - Order ${orderNumber} - LiquorBelle`,
      htmlContent: html
    }, {
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' }
    });
    console.log(`📧 Payment confirmation email sent to ${email}`);
  } catch (err) {
    console.error('❌ Payment email error:', err.response?.data || err.message);
  }
}

// ==================== STK PUSH ENDPOINT ====================
app.post('/api/stkpush',
  stkLimiter,
  body('phone').optional().isString(),
  body('amount').isNumeric(),
  body('total').isNumeric(),
  body('orderId').notEmpty(),
  body('customerName').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Invalid request data', errors: errors.array() });
    }
    
    try {
      const { phone, amount, orderId, customerName, address, items, subtotal, delivery, total } = req.body;
      const formattedPhone = formatPhone(phone);
      const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
      const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');
      const token = await getAccessToken();

      const payload = {
        BusinessShortCode: SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(total),
        PartyA: formattedPhone,
        PartyB: SHORTCODE,
        PhoneNumber: formattedPhone,
        CallBackURL: `https://liquorbelle-mpesa-backend.onrender.com/api/callback`,
        AccountReference: orderId,
        TransactionDesc: `LiquorBelle Order ${orderId}`
      };

      const response = await axios.post(`${baseURL}/mpesa/stkpush/v1/processrequest`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });

      pendingOrders.set(orderId, {
        customerName, phone: formattedPhone, address, items, subtotal, delivery, total, orderId
      });

      res.json({ success: true, checkoutRequestID: response.data.CheckoutRequestID });
    } catch (err) {
      console.error('STK Push Error:', err.response?.data || err.message);
      res.status(500).json({ success: false, message: 'Payment initiation failed' });
    }
  }
);

// ==================== M-PESA CALLBACK ====================
app.post('/api/callback', async (req, res) => {
  const callback = req.body;
  const stkCallback = callback?.Body?.stkCallback;
  if (!stkCallback) return res.json({ ResultCode: 0 });

  const orderId = stkCallback.CallbackMetadata?.Item?.find(i => i.Name === 'AccountReference')?.Value;
  const amount = stkCallback.CallbackMetadata?.Item?.find(i => i.Name === 'Amount')?.Value;

  if (stkCallback.ResultCode === 0) {
    console.log(`✅ Payment successful for order ${orderId}, amount ${amount}`);
    const order = pendingOrders.get(orderId);
    if (order) {
      let msg = `✅ PAYMENT CONFIRMED ✅\n\n`;
      msg += `Order ID: ${order.orderId}\n`;
      msg += `Customer: ${order.customerName}\n`;
      msg += `Phone: ${order.phone}\n`;
      msg += `Address: ${order.address}\n\n`;
      msg += `ITEMS:\n`;
      order.items.forEach(i => { msg += `• ${i.name} x${i.qty} — KES ${(i.price * i.qty).toLocaleString()}\n`; });
      msg += `\nSubtotal: KES ${order.subtotal.toLocaleString()}\n`;
      msg += `Delivery: ${order.delivery === 0 ? 'FREE' : 'KES ' + order.delivery.toLocaleString()}\n`;
      msg += `TOTAL PAID: KES ${order.total.toLocaleString()}\n\n`;
      msg += `📍 Please share your live location now for delivery. 📍\n(📎 → Location → Share Live Location)`;
      pendingOrders.set(orderId, { ...order, paid: true, message: msg });
    }
  } else {
    console.log(`❌ Payment failed: ${stkCallback.ResultDesc}`);
  }
  res.json({ ResultCode: 0 });
});

// ==================== PAYMENT STATUS ====================
app.get('/api/status/:orderId', (req, res) => {
  const order = pendingOrders.get(req.params.orderId);
  if (order && order.paid) {
    const waLink = `https://wa.me/${BUSINESS_NUMBER}?text=${encodeURIComponent(order.message)}`;
    res.json({ status: 'paid', waLink, message: order.message });
  } else {
    res.json({ status: 'pending' });
  }
});

// ==================== EMAIL OTP ====================
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const otpStore = new Map();

app.post('/api/send-email-otp',
  otpLimiter,
  body('email').isEmail().normalizeEmail(),
  body('otp').isLength({ min: 6, max: 6 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.json({ success: false, message: 'Invalid email format' });
    }
    
    const { email, otp } = req.body;
    
    if (!BREVO_API_KEY) {
      console.error('❌ BREVO_API_KEY not configured');
      return res.json({ success: false, message: 'Email service not configured' });
    }
    
    const expiresAt = Date.now() + 10 * 60 * 1000;
    otpStore.set(email, { otp, expiresAt });
    
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:Arial,sans-serif;">
<div style="max-width:500px;margin:0 auto;padding:20px;">
<div style="background:linear-gradient(135deg,#111118,#17171f);border-radius:24px;padding:32px;border:1px solid #2a2a35;text-align:center;">
<img src="https://i.postimg.cc/PxwLVrdh/227a55e3-ad16-4893-9e87-03dfc202814f.png" alt="LiquorBelle" style="width:55px;margin-bottom:16px;">
<div style="font-size:20px;font-weight:800;color:#fff;margin-bottom:20px;">Liquor<span style="color:#f0a500;">Belle</span></div>
<h2 style="color:#e03131;font-size:22px;margin-bottom:16px;">Verification Code</h2>
<div style="font-size:40px;font-weight:800;letter-spacing:8px;background:#1e1e28;padding:20px;border-radius:16px;color:#f0a500;font-family:monospace;">${otp}</div>
<p style="color:#aaa;margin:20px 0 12px;">Expires in <strong style="color:#f0a500;">10 minutes</strong></p>
<hr style="border-color:#2a2a35;margin:20px 0;">
<p style="color:#666;font-size:11px;">LiquorBelle — Dagoretti's Finest | 24/7 Delivery | Over 18 only</p>
</div>
</div>
</body>
</html>`;
    
    try {
      await axios.post('https://api.brevo.com/v3/smtp/email', {
        sender: { name: 'LiquorBelle', email: 'timblax0@gmail.com' },
        to: [{ email: email }],
        subject: 'Your LiquorBelle Verification Code',
        htmlContent: html
      }, {
        headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' }
      });
      
      console.log(`✅ OTP sent to ${email}`);
      res.json({ success: true, message: 'OTP sent to email' });
    } catch (err) {
      console.error('❌ Brevo API Error:', err.response?.data || err.message);
      res.json({ success: false, message: 'Failed to send email. Please try again.' });
    }
  }
);

app.post('/api/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  const stored = otpStore.get(email);
  
  if (!stored) return res.json({ success: false, message: 'No OTP found. Request a new one.' });
  if (Date.now() > stored.expiresAt) {
    otpStore.delete(email);
    return res.json({ success: false, message: 'OTP expired. Request a new one.' });
  }
  if (stored.otp !== otp) return res.json({ success: false, message: 'Invalid OTP. Try again.' });
  
  otpStore.delete(email);
  res.json({ success: true, message: 'Verification successful' });
});

// ==================== ORDER CONFIRMATION EMAIL ====================
app.post('/api/send-order-email', async (req, res) => {
  const { email, orderId, customerName, phone, items, subtotal, delivery, total, address, timestamp, paymentMethod } = req.body;
  
  if (!email || !orderId) {
    return res.json({ success: false, message: 'Missing required fields' });
  }
  
  if (!BREVO_API_KEY) {
    console.error('❌ BREVO_API_KEY not configured');
    return res.json({ success: false, message: 'Email service not configured' });
  }
  
  const html = generateOrderEmailHtml({
    orderId,
    customerName,
    items,
    subtotal,
    delivery,
    total,
    address,
    timestamp,
    paymentMethod,
    phone
  }, false);
  
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'LiquorBelle', email: 'timblax0@gmail.com' },
      to: [{ email: email }],
      subject: `Order Confirmation ${orderId} - LiquorBelle`,
      htmlContent: html
    }, {
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' }
    });
    
    console.log(`📧 Order confirmation sent to ${email}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Order email error:', err.response?.data || err.message);
    res.json({ success: false, message: 'Failed to send confirmation email' });
  }
});

// ==================== DATABASE API ENDPOINTS ====================

app.get('/api/db/products', async (req, res) => {
  try {
    const products = await getAllProducts();
    res.json({ success: true, products });
  } catch (err) {
    console.error('Products fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

app.post('/api/db/products', async (req, res) => {
  try {
    const product = await createProduct(req.body);
    res.json({ success: true, product });
  } catch (err) {
    console.error('Product create error:', err);
    res.status(500).json({ success: false, message: 'Failed to create product' });
  }
});

app.put('/api/db/products/:id', async (req, res) => {
  try {
    const product = await updateProduct(req.params.id, req.body);
    res.json({ success: true, product });
  } catch (err) {
    console.error('Product update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update product' });
  }
});

app.delete('/api/db/products/:id', async (req, res) => {
  try {
    await deleteProduct(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Product delete error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete product' });
  }
});

app.get('/api/db/orders', async (req, res) => {
  try {
    const orders = await getAllOrders();
    res.json({ success: true, orders });
  } catch (err) {
    console.error('Orders fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

app.post('/api/db/orders', async (req, res) => {
  try {
    const { orderNumber, userId, customerName, customerEmail, phone, address, notes, subtotal, delivery, total, paymentMethod, status, items } = req.body;
    const order = await createOrder({
      orderNumber, userId, customerName, customerEmail, phone, address, notes,
      subtotal, delivery, total, paymentMethod, status
    }, items);
    res.json({ success: true, order });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
});

app.put('/api/db/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const order = await updateOrderStatus(req.params.id, status);
    
    if (status === 'paid') {
      const fullOrder = await getOrderById(req.params.id);
      if (fullOrder && fullOrder.customer_email) {
        // Parse items from JSON if needed
        let items = fullOrder.items;
        if (typeof items === 'string') {
          try { items = JSON.parse(items); } catch(e) { items = []; }
        }
        
        await sendOrderPaidEmail(
          fullOrder.id,
          fullOrder.customer_email,
          fullOrder.customer_name,
          fullOrder.order_number,
          fullOrder.total,
          fullOrder.address,
          items,
          fullOrder.subtotal,
          fullOrder.delivery,
          fullOrder.phone,
          fullOrder.created_at
        );
      }
    }
    
    res.json({ success: true, order });
  } catch (err) {
    console.error('Order status update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
});

app.get('/api/db/stats', async (req, res) => {
  try {
    const stats = await getDashboardStats();
    res.json({ success: true, stats });
  } catch (err) {
    console.error('Stats fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});

// ==================== DELIVERY SETTINGS ====================
app.get('/api/admin/delivery-settings', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM settings WHERE key = 'delivery'`);
    if (result.rows.length === 0) {
      return res.json({ 
        success: true, 
        settings: { 
          delivery_fee: 150, 
          free_delivery_threshold: 3000,
          delivery_enabled: true 
        } 
      });
    }
    res.json({ success: true, settings: result.rows[0].value });
  } catch (err) {
    console.error('Get delivery settings error:', err);
    res.status(500).json({ success: false, message: 'Failed to get settings' });
  }
});

app.post('/api/admin/delivery-settings', async (req, res) => {
  try {
    const { delivery_fee, free_delivery_threshold, delivery_enabled } = req.body;
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(50) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pool.query(`
      INSERT INTO settings (key, value) 
      VALUES ('delivery', $1) 
      ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
    `, [JSON.stringify({ delivery_fee, free_delivery_threshold, delivery_enabled }), JSON.stringify({ delivery_fee, free_delivery_threshold, delivery_enabled })]);
    
    res.json({ success: true, message: 'Delivery settings saved' });
  } catch (err) {
    console.error('Update delivery settings error:', err);
    res.status(500).json({ success: false, message: 'Failed to update settings' });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    brevoConfigured: !!BREVO_API_KEY,
    message: 'LiquorBelle API is running',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📧 Brevo API Key: ${BREVO_API_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`💳 M-PESA: ${CONSUMER_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`🔒 Rate Limiting: ✅ Active`);
  console.log(`🗄️ Database: ${process.env.DATABASE_URL ? '✅ Connected' : '❌ Missing'}`);
});
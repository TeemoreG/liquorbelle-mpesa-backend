require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { MongoClient, ObjectId } = require('mongodb');

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

// ==================== MONGODB CONNECTION ====================
const MONGODB_URI = process.env.MONGODB_URI;
let db;
let client;

async function connectDB() {
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('liquorbelle');
    console.log('✅ MongoDB connected');
    
    // Create indexes
    await db.collection('products').createIndex({ name: 1 });
    await db.collection('orders').createIndex({ customer_email: 1 });
    await db.collection('settings').createIndex({ key: 1 });
    
    // Check if products exist - if not, seed with initial products
    const productCount = await db.collection('products').countDocuments();
    if (productCount === 0) {
      console.log('📦 No products found. Seeding initial products...');
      await db.collection('products').insertMany([
        { 
          name: "Chrome Gin", 
          category: "gin", 
          badge: "local", 
          image: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=300&h=300&fit=crop", 
          description: "Premium Kenyan gin with unique botanical blend", 
          variants: [
            { size: "250ml", price: 600, discount: 0 },
            { size: "500ml", price: 1100, discount: 0 },
            { size: "750ml", price: 1650, discount: 0 },
            { size: "1L", price: 2200, discount: 0 }
          ], 
          created_at: new Date() 
        },
        { 
          name: "Konyagi", 
          category: "brandy", 
          badge: "local", 
          image: "https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop", 
          description: "Tanzania's finest premium spirit", 
          variants: [
            { size: "250ml", price: 250, discount: 0 },
            { size: "500ml", price: 450, discount: 0 },
            { size: "750ml", price: 700, discount: 0 },
            { size: "1L", price: 950, discount: 0 }
          ], 
          created_at: new Date() 
        },
        { 
          name: "Johnnie Walker Black Label", 
          category: "whisky", 
          badge: "hot", 
          image: "https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop", 
          description: "Smooth, complex, and rich with notes of vanilla and honey", 
          variants: [
            { size: "750ml", price: 3500, discount: 0 },
            { size: "1L", price: 4500, discount: 0 }
          ], 
          created_at: new Date() 
        },
        { 
          name: "Jameson Irish Whiskey", 
          category: "whisky", 
          badge: "", 
          image: "https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop", 
          description: "Smooth triple-distilled Irish whiskey", 
          variants: [
            { size: "750ml", price: 3200, discount: 0 },
            { size: "1L", price: 4200, discount: 0 }
          ], 
          created_at: new Date() 
        },
        { 
          name: "Hennessy VS", 
          category: "cognac", 
          badge: "prem", 
          image: "https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop", 
          description: "World-renowned cognac with fruity and spicy notes", 
          variants: [
            { size: "750ml", price: 5500, discount: 0 },
            { size: "1L", price: 7200, discount: 0 }
          ], 
          created_at: new Date() 
        },
        { 
          name: "Smirnoff Red Vodka", 
          category: "vodka", 
          badge: "", 
          image: "https://images.unsplash.com/photo-1614313913007-2f5ad100323c?w=300&h=300&fit=crop", 
          description: "World's best-selling vodka, triple distilled", 
          variants: [
            { size: "250ml", price: 550, discount: 0 },
            { size: "500ml", price: 800, discount: 0 },
            { size: "750ml", price: 1100, discount: 0 },
            { size: "1L", price: 1500, discount: 0 }
          ], 
          created_at: new Date() 
        },
        { 
          name: "Gilbeys Gin", 
          category: "gin", 
          badge: "local", 
          image: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=300&h=300&fit=crop", 
          description: "Classic London dry gin, locally bottled", 
          variants: [
            { size: "250ml", price: 700, discount: 0 },
            { size: "500ml", price: 1050, discount: 0 },
            { size: "750ml", price: 1400, discount: 0 },
            { size: "1L", price: 1900, discount: 0 }
          ], 
          created_at: new Date() 
        },
        { 
          name: "Absolut Vodka", 
          category: "vodka", 
          badge: "", 
          image: "https://images.unsplash.com/photo-1614313913007-2f5ad100323c?w=300&h=300&fit=crop", 
          description: "Premium Swedish vodka with rich grain character", 
          variants: [
            { size: "750ml", price: 1800, discount: 0 },
            { size: "1L", price: 2400, discount: 0 }
          ], 
          created_at: new Date() 
        },
        { 
          name: "Kenya Cane Ginger", 
          category: "rum", 
          badge: "local", 
          image: "https://images.unsplash.com/photo-1565277408825-5da2b2a4b1dd?w=300&h=300&fit=crop", 
          description: "Locally produced sugarcane rum with ginger", 
          variants: [
            { size: "250ml", price: 500, discount: 0 },
            { size: "500ml", price: 850, discount: 0 },
            { size: "750ml", price: 1200, discount: 0 },
            { size: "1L", price: 1600, discount: 0 }
          ], 
          created_at: new Date() 
        },
        { 
          name: "Tusker Lager", 
          category: "beer", 
          badge: "local", 
          image: "https://images.unsplash.com/photo-1561758033-d89a9ad46330?w=300&h=300&fit=crop", 
          description: "Kenya's favorite premium lager", 
          variants: [
            { size: "500ml", price: 230, discount: 0 },
            { size: "12pack", price: 2500, discount: 0 }
          ], 
          created_at: new Date() 
        }
      ]);
      console.log('✅ 10 products seeded with multiple size variants');
    } else {
      console.log(`✅ Products already exist (${productCount} products), skipping seed`);
    }
    
    console.log('✅ Database ready');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    setTimeout(connectDB, 5000);
  }
}

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
    
    const orders = await db.collection('orders').find({ customer_email: email }).sort({ created_at: -1 }).toArray();
    res.json({ success: true, orders });
  } catch (err) {
    console.error('Email order lookup error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==================== MODERN EMAIL TEMPLATE ====================
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
      <td style="padding: 14px 0; color: #e0e0e0; font-size: 14px;">${escapeHtml(item.name)} <span style="color: #888; font-size: 12px;">x${item.qty}</span> <span style="color: #666; font-size: 11px;">(${item.size || '750ml'})</span></td>
      <td style="padding: 14px 0; text-align: right; color: #f0a500; font-weight: 700; font-size: 14px;">KES ${(item.price * item.qty).toLocaleString()}</td>
    </tr>
  `).join('');

  const deliveryText = delivery === 0 ? 'FREE' : `KES ${delivery.toLocaleString()}`;
  const paymentText = paymentMethod === 'mpesa' ? 'M-PESA (STK Push)' : 'Cash on Delivery';
  const formattedPhone = phone ? escapeHtml(phone) : 'Provided at checkout';
  
  const statusColor = isPaymentConfirmed ? '#2ecc71' : '#f0a500';
  const statusText = isPaymentConfirmed ? 'PAYMENT CONFIRMED ✓' : 'ORDER RECEIVED';
  const statusBg = isPaymentConfirmed ? 'rgba(46,204,113,0.12)' : 'rgba(240,165,0,0.12)';
  const accentColor = isPaymentConfirmed ? '#2ecc71' : '#e03131';
  const headerGradient = isPaymentConfirmed 
    ? 'linear-gradient(135deg, #0d2e1a, #111118)' 
    : 'linear-gradient(135deg, #2e1a1a, #111118)';

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${isPaymentConfirmed ? '✅ Payment Confirmed' : '📦 Order Confirmed'} - LiquorBelle</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:580px;margin:0 auto;padding:20px;">
<div style="background:linear-gradient(135deg,#111118 0%,#17171f 100%);border-radius:28px;overflow:hidden;border:1px solid #2a2a35;box-shadow:0 12px 32px rgba(0,0,0,0.5);">
<div style="background:${headerGradient};text-align:center;padding:32px 24px 24px;border-bottom:1px solid #2a2a35;">
<img src="https://i.postimg.cc/PxwLVrdh/227a55e3-ad16-4893-9e87-03dfc202814f.png" alt="LiquorBelle" style="width:65px;height:auto;margin-bottom:12px;border-radius:12px;">
<div style="font-size:24px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Liquor<span style="color:${accentColor};">Belle</span></div>
<div style="font-size:12px;color:#888;margin-top:6px;">Dagoretti's Finest • 24/7 Delivery</div>
</div>
<div style="text-align:center;padding:28px 24px 0;"><span style="display:inline-block;background:${statusBg};color:${statusColor};padding:8px 22px;border-radius:50px;font-size:12px;font-weight:800;letter-spacing:1px;border:1px solid ${statusColor}40;">${statusText}</span></div>
<div style="padding:24px 24px 0;"><h2 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 8px;">Hello ${escapeHtml(customerName)},</h2><p style="color:#aaa;font-size:15px;line-height:1.5;margin:0;">${isPaymentConfirmed ? '🎉 Your payment has been successfully confirmed! We\'re getting your order ready.' : '📋 Thank you for shopping with LiquorBelle! Your order has been received.'}</p></div>
<div style="display:flex;gap:12px;flex-wrap:wrap;margin:24px 24px 0;"><div style="flex:1;background:#1e1e28;border-radius:16px;padding:14px;"><div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Order Number</div><div style="color:#f0a500;font-size:14px;font-weight:800;">${orderId}</div></div><div style="flex:1;background:#1e1e28;border-radius:16px;padding:14px;"><div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Order Date</div><div style="color:#e0e0e0;font-size:13px;font-weight:600;">${timestamp}</div></div><div style="flex:1;background:#1e1e28;border-radius:16px;padding:14px;"><div style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Payment</div><div style="color:${accentColor};font-size:13px;font-weight:700;">${paymentText}</div></div></div>
<div style="margin:24px 24px 0;"><div style="background:#1e1e28;border-radius:20px;overflow:hidden;"><div style="background:#24242f;padding:14px 20px;"><span style="font-weight:700;color:#f0a500;font-size:14px;">🍾 Order Summary</span></div><table style="width:100%;border-collapse:collapse;padding:0 20px;"><tbody>${itemsRows}</tbody></table><div style="background:#252530;margin:12px 16px 16px 16px;border-radius:16px;padding:4px 0;"><div style="display:flex;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #333344;"><span style="color:#ccc;font-size:15px;font-weight:600;">Subtotal</span><span style="color:#f0a500;font-size:16px;font-weight:800;">KES ${subtotal.toLocaleString()}</span></div><div style="display:flex;justify-content:space-between;padding:14px 20px;"><span style="color:#ccc;font-size:15px;font-weight:600;">Delivery Fee</span><span style="color:${delivery === 0 ? '#2ecc71' : '#f0a500'};font-size:16px;font-weight:800;">${deliveryText}</span></div></div><div style="background:linear-gradient(135deg,#2a1a1a,#1a1a1a);margin:0 16px 20px 16px;border-radius:16px;padding:16px 20px;border-left:4px solid #e03131;"><div style="display:flex;justify-content:space-between;align-items:center;"><span style="color:#fff;font-size:18px;font-weight:800;">TOTAL</span><span style="color:#e03131;font-size:24px;font-weight:900;">KES ${total.toLocaleString()}</span></div></div></div></div>
<div style="margin:20px 24px;"><div style="background:#1e1e28;border-radius:20px;padding:18px;border:1px solid #2a2a35;"><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;"><span style="font-size:22px;">📍</span><span style="color:#f0a500;font-weight:800;font-size:12px;letter-spacing:0.5px;">DELIVERY ADDRESS</span></div><div style="color:#e0e0e0;font-size:14px;line-height:1.5;margin-bottom:10px;">${escapeHtml(address)}</div><div style="display:flex;align-items:center;gap:8px;"><span style="font-size:14px;">📞</span><span style="color:#aaa;font-size:13px;">${formattedPhone}</span></div></div></div>
<div style="margin:0 24px 24px;"><div style="background:${isPaymentConfirmed ? 'rgba(46,204,113,0.06)' : 'rgba(240,165,0,0.06)'};border-radius:20px;padding:20px;text-align:center;border:1px solid ${accentColor}30;"><div style="font-size:36px;margin-bottom:10px;">${isPaymentConfirmed ? '🚚✨' : '⏳📦'}</div><div style="color:${accentColor};font-weight:800;font-size:16px;margin-bottom:6px;">${isPaymentConfirmed ? 'Order Confirmed & Processing' : 'Payment Pending Confirmation'}</div><div style="color:#aaa;font-size:13px;line-height:1.4;">${isPaymentConfirmed ? 'Our rider will contact you on ' + formattedPhone + ' within 45 minutes' : 'Complete your M-PESA payment to confirm this order'}</div></div></div>
<div style="text-align:center;padding:0 24px 24px;"><a href="https://teemoreg.github.io/liquorbelle/track-orders.html?email=${encodeURIComponent(orderData.customerEmail || '')}" style="display:inline-block;background:linear-gradient(135deg,#e03131,#c0392b);color:#fff;text-decoration:none;padding:14px 32px;border-radius:60px;font-weight:700;font-size:15px;box-shadow:0 4px 12px rgba(224,49,49,0.3);">🔍 Track Your Order</a></div>
<div style="text-align:center;padding:20px 24px 24px;background:#0d0d12;border-top:1px solid #2a2a35;"><div style="margin-bottom:12px;"><span style="color:#555;font-size:11px;">📞 +254 748 894 443</span><span style="color:#444;margin:0 8px;">•</span><span style="color:#555;font-size:11px;">💬 WhatsApp 24/7</span></div><p style="color:#444;font-size:10px;margin:8px 0 0;">⚠️ You must be over 18 to purchase alcohol. Drink responsibly.</p><p style="color:#3a3a3a;font-size:9px;margin:12px 0 0;">LiquorBelle — Dagoretti Road, Opposite Quickmart</p></div>
</div>
</div>
</body>
</html>`;
  return fullHtml;
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
    phone: phone || '',
    customerEmail: email
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
    phone,
    customerEmail: email
  }, false);
  
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'LiquorBelle', email: 'timblax0@gmail.com' },
      to: [{ email: email }],
      subject: `📦 Order Confirmation ${orderId} - LiquorBelle`,
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

// ==================== DATABASE API ENDPOINTS (MONGODB) ====================

// Get all products
app.get('/api/db/products', async (req, res) => {
  try {
    const products = await db.collection('products').find({}).sort({ created_at: -1 }).toArray();
    res.json({ success: true, products });
  } catch (err) {
    console.error('Products fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

// Create product with variants
app.post('/api/db/products', async (req, res) => {
  try {
    const { name, category, badge, image, description, variants } = req.body;
    
    if (!name || !variants || variants.length === 0) {
      return res.status(400).json({ success: false, message: 'Name and at least one variant required' });
    }
    
    for (const v of variants) {
      if (!v.size || typeof v.price !== 'number') {
        return res.status(400).json({ success: false, message: 'Each variant must have size and valid price' });
      }
    }
    
    const product = { 
      name, 
      category: category || 'other', 
      badge: badge || '', 
      image: image || '', 
      description: description || '', 
      variants, 
      created_at: new Date(), 
      updated_at: new Date() 
    };
    const result = await db.collection('products').insertOne(product);
    res.json({ success: true, product: { id: result.insertedId, ...product } });
  } catch (err) {
    console.error('Product create error:', err);
    res.status(500).json({ success: false, message: 'Failed to create product' });
  }
});

// Update product with variants
app.put('/api/db/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, badge, image, description, variants } = req.body;
    
    if (!name || !variants || variants.length === 0) {
      return res.status(400).json({ success: false, message: 'Name and at least one variant required' });
    }
    
    for (const v of variants) {
      if (!v.size || typeof v.price !== 'number') {
        return res.status(400).json({ success: false, message: 'Each variant must have size and valid price' });
      }
    }
    
    const result = await db.collection('products').updateOne(
      { _id: new ObjectId(id) },
      { $set: { name, category, badge, image, description, variants, updated_at: new Date() } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Product update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update product' });
  }
});

// Delete product
app.delete('/api/db/products/:id', async (req, res) => {
  try {
    const result = await db.collection('products').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Product delete error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete product' });
  }
});

// Get all orders
app.get('/api/db/orders', async (req, res) => {
  try {
    const orders = await db.collection('orders').find({}).sort({ created_at: -1 }).toArray();
    res.json({ success: true, orders });
  } catch (err) {
    console.error('Orders fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

// Get order by ID
app.get('/api/db/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const order = await db.collection('orders').findOne({ _id: new ObjectId(id) });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    res.json({ success: true, order });
  } catch (err) {
    console.error('Order fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
});

// Create order
app.post('/api/db/orders', async (req, res) => {
  try {
    const { orderNumber, userId, customerName, customerEmail, phone, address, notes, subtotal, delivery, total, paymentMethod, status, items } = req.body;
    
    const order = {
      order_number: orderNumber,
      user_id: userId,
      customer_name: customerName,
      customer_email: customerEmail,
      phone,
      address,
      notes,
      subtotal,
      delivery,
      total,
      payment_method: paymentMethod,
      status: status || 'pending',
      items: items.map(item => ({ ...item, size: item.size || '750ml' })),
      created_at: new Date(),
      updated_at: new Date()
    };
    
    const result = await db.collection('orders').insertOne(order);
    res.json({ success: true, order: { id: result.insertedId, ...order } });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
});

// Update order status
app.put('/api/db/orders/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const result = await db.collection('orders').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updated_at: new Date() } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    // If status changed to paid, send confirmation email
    if (status === 'paid') {
      const order = await db.collection('orders').findOne({ _id: new ObjectId(id) });
      if (order && order.customer_email) {
        await sendOrderPaidEmail(
          order.id,
          order.customer_email,
          order.customer_name,
          order.order_number,
          order.total,
          order.address,
          order.items || [],
          order.subtotal,
          order.delivery,
          order.phone,
          order.created_at
        );
      }
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Order status update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
});

// Delete order
app.delete('/api/db/orders/:id', async (req, res) => {
  try {
    const result = await db.collection('orders').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Order delete error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete order' });
  }
});

// Dashboard stats
app.get('/api/db/stats', async (req, res) => {
  try {
    const totalOrders = await db.collection('orders').countDocuments();
    const totalProducts = await db.collection('products').countDocuments();
    const deliveredOrders = await db.collection('orders').find({ status: 'delivered' }).toArray();
    const totalRevenue = deliveredOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    const pendingOrdersCount = await db.collection('orders').countDocuments({ status: 'pending' });
    const paidOrdersCount = await db.collection('orders').countDocuments({ status: 'paid' });
    const deliveredOrdersCount = await db.collection('orders').countDocuments({ status: 'delivered' });
    
    res.json({
      success: true,
      stats: {
        totalOrders,
        totalProducts,
        totalRevenue,
        pendingOrders: pendingOrdersCount,
        paidOrders: paidOrdersCount,
        deliveredOrders: deliveredOrdersCount
      }
    });
  } catch (err) {
    console.error('Stats fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});

// Delivery settings
app.get('/api/admin/delivery-settings', async (req, res) => {
  try {
    const settings = await db.collection('settings').findOne({ key: 'delivery' });
    if (!settings) {
      return res.json({
        success: true,
        settings: {
          delivery_fee: 150,
          free_delivery_threshold: 3000,
          delivery_enabled: true
        }
      });
    }
    res.json({ success: true, settings: settings.value });
  } catch (err) {
    console.error('Get delivery settings error:', err);
    res.status(500).json({ success: false, message: 'Failed to get settings' });
  }
});

app.post('/api/admin/delivery-settings', async (req, res) => {
  try {
    const { delivery_fee, free_delivery_threshold, delivery_enabled } = req.body;
    await db.collection('settings').updateOne(
      { key: 'delivery' },
      { $set: { value: { delivery_fee, free_delivery_threshold, delivery_enabled }, updated_at: new Date() } },
      { upsert: true }
    );
    res.json({ success: true, message: 'Delivery settings saved' });
  } catch (err) {
    console.error('Update delivery settings error:', err);
    res.status(500).json({ success: false, message: 'Failed to update settings' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: 'MongoDB',
    brevoConfigured: !!BREVO_API_KEY,
    message: 'LiquorBelle API is running with variants support',
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
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📧 Brevo API Key: ${BREVO_API_KEY ? '✅ Configured' : '❌ Missing'}`);
    console.log(`💳 M-PESA: ${CONSUMER_KEY && CONSUMER_KEY !== 'YOUR_CONSUMER_KEY' ? '✅ Configured' : '❌ Missing'}`);
    console.log(`🔒 Rate Limiting: ✅ Active`);
    console.log(`🗄️ MongoDB: ✅ Connected (Free forever, never expires)`);
  });
});
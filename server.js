require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { MongoClient, ObjectId } = require('mongodb');

// ==================== ENVIRONMENT VALIDATION ====================
if (!process.env.ADMIN_PASSWORD) {
  console.error('❌ ADMIN_PASSWORD env var not set. Refusing to start.');
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI env var not set. Refusing to start.');
  process.exit(1);
}

const app = express();
app.use(cors());
app.set('trust proxy', 1);
app.use(express.json());
app.use(compression());

// ==================== ADMIN CONFIG ====================
const ENV_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
let CASHIER_PASSWORD = process.env.CASHIER_PASSWORD || 'admin123';

// ==================== EMAIL VALIDATION ====================
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/;
  return emailRegex.test(email);
}

// ==================== RATE LIMITING ====================
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
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

const orderCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many orders placed. Please wait.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, message: 'Too many admin requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', generalLimiter);
app.use('/api/send-email-otp', otpLimiter);
app.use('/api/stkpush', stkLimiter);
app.use('/api/db/orders', orderCreateLimiter);
app.use('/api/db/', adminLimiter);
app.use('/api/admin/', adminLimiter);

// ==================== ADMIN/CASHIER MIDDLEWARE ====================
function requireAdminOrCashier(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication token required' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin' && decoded.role !== 'cashier') {
      return res.status(403).json({ success: false, message: 'Access denied. Admin or Cashier role required.' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Admin token required' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid or expired admin token' });
  }
}

// ==================== JWT FOR ADMIN ONLY ====================
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET env var not set. Refusing to start.');
  process.exit(1);
}
const jwt = require('jsonwebtoken');

// ==================== MONGODB CONNECTION ====================
const MONGODB_URI = process.env.MONGODB_URI;
let db;
let client;

// Global variables for active passwords (only from database after first load)
let activeAdminPassword = null;
let activeCashierPassword = null;
let passwordsLoaded = false;

async function loadPasswordsFromDB() {
  try {
    const adminSettings = await db.collection('admin_settings').findOne({ key: 'passwords' });
    if (adminSettings && adminSettings.value) {
      // ONLY use database passwords - ignore environment variables if DB has passwords
      activeAdminPassword = adminSettings.value.adminPassword;
      activeCashierPassword = adminSettings.value.cashierPassword;
      console.log('✅ Loaded passwords from database (using DB passwords only)');
      console.log(`   Admin password: ${activeAdminPassword ? '✓ Set' : '✗ Not set'}`);
      console.log(`   Cashier password: ${activeCashierPassword ? '✓ Set' : '✗ Not set'}`);
      passwordsLoaded = true;
      return true;
    } else {
      // No passwords in database yet, use environment variables as initial
      activeAdminPassword = ENV_ADMIN_PASSWORD;
      activeCashierPassword = CASHIER_PASSWORD;
      console.log('📝 No passwords in database, using environment variables as initial');
      console.log(`   Admin password from env: ${ENV_ADMIN_PASSWORD ? '✓ Set' : '✗ Not set'}`);
      passwordsLoaded = true;
      return false;
    }
  } catch (err) {
    console.error('Error loading passwords from DB:', err.message);
    // Fallback to environment variables
    activeAdminPassword = ENV_ADMIN_PASSWORD;
    activeCashierPassword = CASHIER_PASSWORD;
    return false;
  }
}

async function getActivePasswords() {
  if (!passwordsLoaded) {
    await loadPasswordsFromDB();
  }
  return {
    adminPassword: activeAdminPassword,
    cashierPassword: activeCashierPassword
  };
}

async function connectDB() {
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('liquorbelle');
    console.log('✅ MongoDB connected');

    await db.collection('products').createIndex({ name: 1 });
    await db.collection('orders').createIndex({ customer_email: 1 });
    await db.collection('orders').createIndex({ created_at: -1 });
    await db.collection('settings').createIndex({ key: 1 });
    await db.collection('admin_settings').createIndex({ key: 1 });
    await db.collection('pending_orders').createIndex({ created_at: 1 }, { expireAfterSeconds: 3600 });
    await db.collection('otps').createIndex({ created_at: 1 }, { expireAfterSeconds: 600 });

    // Load passwords from database FIRST
    await loadPasswordsFromDB();

    const productCount = await db.collection('products').countDocuments();
    if (productCount === 0) {
      console.log('📦 No products found. Seeding initial products...');
      await db.collection('products').insertMany(seedProducts);
      console.log('✅ 10 products seeded');
    } else {
      console.log(`✅ Products already exist (${productCount} products), skipping seed`);
    }
    console.log('✅ Database ready');
    
    // Auto-cleanup unpaid pending orders (35 seconds)
    setInterval(async () => {
      try {
        if (!db) return;
        const cutoffTime = new Date(Date.now() - 35000);
        const result = await db.collection('pending_orders').deleteMany({
          paid: false,
          created_at: { $lt: cutoffTime }
        });
        if (result.deletedCount > 0) {
          console.log(`🧹 Auto-cleaned ${result.deletedCount} unpaid pending orders (older than 35 seconds)`);
        }
      } catch (err) {
        // Silent fail
      }
    }, 30000);
    
  } catch (err) {
    console.error('MongoDB connection error:', err);
    setTimeout(connectDB, 5000);
  }
}

const seedProducts = [
  { name: "Chrome Gin", category: "gin", badge: "local", image: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=300&h=300&fit=crop", description: "Premium Kenyan gin", variants: [{ size: "250ml", price: 600, discount: 0 }, { size: "500ml", price: 1100, discount: 0 }, { size: "750ml", price: 1650, discount: 0 }, { size: "1L", price: 2200, discount: 0 }], isTrending: true, created_at: new Date() },
  { name: "Konyagi", category: "brandy", badge: "local", image: "https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop", description: "Tanzania's finest spirit", variants: [{ size: "250ml", price: 250, discount: 0 }, { size: "500ml", price: 450, discount: 0 }, { size: "750ml", price: 700, discount: 0 }, { size: "1L", price: 950, discount: 0 }], isTrending: true, created_at: new Date() },
  { name: "Johnnie Walker Black Label", category: "whisky", badge: "hot", image: "https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop", description: "Smooth, complex whisky", variants: [{ size: "750ml", price: 3500, discount: 0 }, { size: "1L", price: 4500, discount: 0 }], isTrending: true, created_at: new Date() },
  { name: "Jameson Irish Whiskey", category: "whisky", badge: "", image: "https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop", description: "Smooth triple-distilled whiskey", variants: [{ size: "750ml", price: 3200, discount: 0 }, { size: "1L", price: 4200, discount: 0 }], isTrending: true, created_at: new Date() },
  { name: "Hennessy VS", category: "cognac", badge: "prem", image: "https://images.unsplash.com/photo-1584211065398-1acb769997e0?w=300&h=300&fit=crop", description: "World-renowned cognac", variants: [{ size: "750ml", price: 5500, discount: 0 }, { size: "1L", price: 7200, discount: 0 }], isTrending: true, created_at: new Date() },
  { name: "Smirnoff Red Vodka", category: "vodka", badge: "", image: "https://images.unsplash.com/photo-1614313913007-2f5ad100323c?w=300&h=300&fit=crop", description: "World's best-selling vodka", variants: [{ size: "250ml", price: 550, discount: 0 }, { size: "500ml", price: 800, discount: 0 }, { size: "750ml", price: 1100, discount: 0 }, { size: "1L", price: 1500, discount: 0 }], isTrending: true, created_at: new Date() },
  { name: "Gilbeys Gin", category: "gin", badge: "local", image: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=300&h=300&fit=crop", description: "Classic London dry gin", variants: [{ size: "250ml", price: 700, discount: 0 }, { size: "500ml", price: 1050, discount: 0 }, { size: "750ml", price: 1400, discount: 0 }, { size: "1L", price: 1900, discount: 0 }], isTrending: true, created_at: new Date() },
  { name: "Absolut Vodka", category: "vodka", badge: "", image: "https://images.unsplash.com/photo-1614313913007-2f5ad100323c?w=300&h=300&fit=crop", description: "Premium Swedish vodka", variants: [{ size: "750ml", price: 1800, discount: 0 }, { size: "1L", price: 2400, discount: 0 }], isTrending: true, created_at: new Date() },
  { name: "Kenya Cane Ginger", category: "rum", badge: "local", image: "https://images.unsplash.com/photo-1565277408825-5da2b2a4b1dd?w=300&h=300&fit=crop", description: "Locally produced sugarcane rum", variants: [{ size: "250ml", price: 500, discount: 0 }, { size: "500ml", price: 850, discount: 0 }, { size: "750ml", price: 1200, discount: 0 }, { size: "1L", price: 1600, discount: 0 }], isTrending: true, created_at: new Date() },
  { name: "Tusker Lager", category: "beer", badge: "local", image: "https://images.unsplash.com/photo-1561758033-d89a9ad46330?w=300&h=300&fit=crop", description: "Kenya's favorite lager", variants: [{ size: "500ml", price: 230, discount: 0 }, { size: "12pack", price: 2500, discount: 0 }], isTrending: true, created_at: new Date() }
];

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

const BREVO_API_KEY = process.env.BREVO_API_KEY;

// ==================== EMAIL FUNCTIONS ====================
async function sendCodOrderReceivedEmail(orderData) {
  if (!BREVO_API_KEY) return;
  const { orderId, customerName, items, subtotal, delivery, total, address, phone, customerEmail } = orderData;
  const deliveryText = delivery === 0 ? 'FREE' : `KES ${delivery.toLocaleString()}`;
  
  const itemsHtml = (items || []).map(item => {
    const productName = item.product_name || item.name || 'Product';
    const productQty = item.quantity || item.qty || 1;
    const productPrice = item.price || 0;
    const productSize = item.size || '750ml';
    return `
      <tr style="border-bottom:1px solid #1c1c28;">
        <td style="padding:12px 0;"><span style="color:#e0e0e0;">${escapeHtml(productName)} x${productQty}</span><br><span style="color:#555;font-size:11px;">${escapeHtml(productSize)}</span></td>
        <td style="padding:12px 0;text-align:right;color:#f0a500;">KES ${(productPrice * productQty).toLocaleString()}</td>
      </tr>
    `;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Order Received - LiquorBelle</title></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:Arial,sans-serif;">
<div style="max-width:580px;margin:0 auto;padding:20px;">
<div style="background:#111118;border-radius:24px;overflow:hidden;border:1px solid #1e1e2c;">
  <div style="height:3px;background:linear-gradient(90deg,#f0a500,#e03131,#f0a500);"></div>
  <div style="background:#1a0808;text-align:center;padding:32px 24px;">
    <img src="https://res.cloudinary.com/dvqjgbdhp/image/upload/v1780905905/WhatsApp_Image_2026-06-04_at_3.41.50_PM_saprsh.jpg" alt="LiquorBelle" style="width:60px;border-radius:16px;margin-bottom:12px;">
    <div style="font-size:26px;font-weight:900;color:#fff;">Liquor<span style="color:#f0a500;">Belle</span></div>
    <div style="color:#666;font-size:11px;">Dagoretti's Finest · 24/7 Delivery</div>
  </div>
  <div style="text-align:center;padding:20px 24px 0;">
    <span style="background:rgba(240,165,0,0.12);color:#f0a500;padding:8px 20px;border-radius:50px;font-size:11px;font-weight:800;">📋 ORDER RECEIVED - RIDER ON THE WAY</span>
  </div>
  <div style="padding:20px 28px;">
    <h2 style="color:#fff;font-size:18px;">Hello ${escapeHtml(customerName)},</h2>
    <p style="color:#888;font-size:14px;">🎉 Your order has been received! Our rider is on the way to deliver your drinks.</p>
    <p style="color:#888;font-size:14px;margin-top:12px;">📞 The rider will call <strong style="color:#f0a500;">${escapeHtml(phone)}</strong> when approaching your location.</p>
    <p style="color:#ff6b6b;font-size:14px;font-weight:700;">💰 Please have the exact cash ready upon delivery.</p>
  </div>
  <div style="padding:0 28px;">
    <table style="width:100%;background:#16161f;border-radius:16px;overflow:hidden;">
      <tr style="background:#1a1a26;"><td colspan="2" style="padding:12px 16px;color:#f0a500;font-weight:800;">🍾 ORDER ITEMS</td></tr>
      ${itemsHtml}
      <tr><td style="padding:12px 16px;color:#777;">Subtotal</td><td style="padding:12px 16px;text-align:right;color:#ccc;">KES ${subtotal.toLocaleString()}</td></tr>
      <tr><td style="padding:12px 16px;color:#777;">Delivery Fee</td><td style="padding:12px 16px;text-align:right;color:#ccc;">${deliveryText}</td></tr>
      <tr style="background:#1a0808;"><td style="padding:16px;color:#fff;font-weight:800;">TOTAL TO PAY</td><td style="padding:16px;text-align:right;color:#f0a500;font-size:20px;font-weight:800;">KES ${total.toLocaleString()}</td></tr>
    </table>
  </div>
  <div style="margin:20px 28px;background:#16161f;border-radius:16px;padding:16px;">
    <div style="color:#f0a500;">📍 DELIVERY ADDRESS</div>
    <div style="color:#ddd;">${escapeHtml(address)}</div>
    <div style="color:#666;margin-top:8px;">📞 ${escapeHtml(phone)}</div>
  </div>
  <div style="margin:0 28px 20px;background:rgba(240,165,0,0.08);border-radius:16px;padding:16px;text-align:center;">
    <div style="font-size:28px;">🏍️</div>
    <div style="color:#f0a500;font-weight:800;">Estimated Delivery: 10-45 minutes</div>
    <div style="color:#666;">Rider will call before arrival</div>
  </div>
  <div style="padding:20px 28px;text-align:center;">
    <a href="https://teemoreg.github.io/liquorbelle/track-orders.html?email=${encodeURIComponent(customerEmail)}" style="background:#e03131;color:#fff;padding:12px 32px;border-radius:50px;text-decoration:none;font-weight:800;">🔍 Track Order</a>
  </div>
  <div style="background:#0d0d14;text-align:center;padding:16px;color:#444;">📞 +254 748 894 443 · WhatsApp 24/7</div>
</div>
</div>
</body>
</html>`;

  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'LiquorBelle', email: 'timblax0@gmail.com' },
      to: [{ email: customerEmail }],
      subject: `📦 Order Received - ${orderId} - LiquorBelle`,
      htmlContent: html
    }, { headers: { 'api-key': BREVO_API_KEY } });
    console.log(`📧 COD order received email sent to ${customerEmail}`);
  } catch (err) { console.error('Email error:', err.message); }
}

async function sendMpesaOrderReceivedEmail(orderData) {
  if (!BREVO_API_KEY) return;
  const { orderId, customerName, items, subtotal, delivery, total, address, phone, customerEmail } = orderData;
  const deliveryText = delivery === 0 ? 'FREE' : `KES ${delivery.toLocaleString()}`;
  
  const itemsHtml = (items || []).map(item => {
    const productName = item.product_name || item.name || 'Product';
    const productQty = item.quantity || item.qty || 1;
    const productPrice = item.price || 0;
    const productSize = item.size || '750ml';
    return `
      <tr style="border-bottom:1px solid #1c1c28;">
        <td style="padding:12px 0;"><span style="color:#e0e0e0;">${escapeHtml(productName)} x${productQty}</span><br><span style="color:#555;font-size:11px;">${escapeHtml(productSize)}</span></td>
        <td style="padding:12px 0;text-align:right;color:#f0a500;">KES ${(productPrice * productQty).toLocaleString()}</td>
      </tr>
    `;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Payment Received - LiquorBelle</title></head>
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
    <span style="background:rgba(46,204,113,0.12);color:#2ecc71;padding:8px 20px;border-radius:50px;font-size:11px;font-weight:800;">✅ PAYMENT RECEIVED - ORDER ON THE WAY</span>
  </div>
  <div style="padding:20px 28px;">
    <h2 style="color:#fff;font-size:18px;">Hello ${escapeHtml(customerName)},</h2>
    <p style="color:#888;font-size:14px;">🎉 Your M-PESA payment of <strong style="color:#2ecc71;">KES ${total.toLocaleString()}</strong> has been received!</p>
    <p style="color:#888;font-size:14px;margin-top:12px;">🚚 Your order is now being prepared. Our rider is on the way to deliver your drinks.</p>
    <p style="color:#888;font-size:14px;">📞 The rider will call <strong style="color:#f0a500;">${escapeHtml(phone)}</strong> when approaching your location.</p>
  </div>
  <div style="padding:0 28px;">
    <table style="width:100%;background:#16161f;border-radius:16px;overflow:hidden;">
      <tr style="background:#1a1a26;"><td colspan="2" style="padding:12px 16px;color:#f0a500;font-weight:800;">🍾 ORDER ITEMS</td></tr>
      ${itemsHtml}
      <tr><td style="padding:12px 16px;color:#777;">Subtotal</td><td style="padding:12px 16px;text-align:right;color:#ccc;">KES ${subtotal.toLocaleString()}</td></tr>
      <tr><td style="padding:12px 16px;color:#777;">Delivery Fee</td><td style="padding:12px 16px;text-align:right;color:#ccc;">${deliveryText}</td></tr>
      <tr style="background:#0a1a0a;"><td style="padding:16px;color:#fff;font-weight:800;">TOTAL PAID</td><td style="padding:16px;text-align:right;color:#2ecc71;font-size:20px;font-weight:800;">KES ${total.toLocaleString()}</td></tr>
    </table>
  </div>
  <div style="margin:20px 28px;background:#16161f;border-radius:16px;padding:16px;">
    <div style="color:#2ecc71;">📍 DELIVERY ADDRESS</div>
    <div style="color:#ddd;">${escapeHtml(address)}</div>
    <div style="color:#666;margin-top:8px;">📞 ${escapeHtml(phone)}</div>
  </div>
  <div style="margin:0 28px 20px;background:rgba(46,204,113,0.08);border-radius:16px;padding:16px;text-align:center;">
    <div style="font-size:28px;">🏍️</div>
    <div style="color:#2ecc71;font-weight:800;">Estimated Delivery: 10-45 minutes</div>
    <div style="color:#666;">Rider will call before arrival</div>
  </div>
  <div style="padding:20px 28px;text-align:center;">
    <a href="https://teemoreg.github.io/liquorbelle/track-orders.html?email=${encodeURIComponent(customerEmail)}" style="background:#e03131;color:#fff;padding:12px 32px;border-radius:50px;text-decoration:none;font-weight:800;">🔍 Track Order</a>
  </div>
  <div style="background:#0d0d14;text-align:center;padding:16px;color:#444;">📞 +254 748 894 443 · WhatsApp 24/7</div>
</div>
</div>
</body>
</html>`;

  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'LiquorBelle', email: 'timblax0@gmail.com' },
      to: [{ email: customerEmail }],
      subject: `✅ Payment Received - ${orderId} - LiquorBelle`,
      htmlContent: html
    }, { headers: { 'api-key': BREVO_API_KEY } });
    console.log(`📧 M-PESA payment received email sent to ${customerEmail}`);
  } catch (err) { console.error('Email error:', err.message); }
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
<head><meta charset="UTF-8"><title>Order Delivered - LiquorBelle</title></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:Arial,sans-serif;">
<div style="max-width:580px;margin:0 auto;padding:20px;">
<div style="background:#111118;border-radius:24px;overflow:hidden;border:1px solid #1e1e2c;">
  <div style="height:3px;background:linear-gradient(90deg,#2ecc71,#f0a500,#2ecc71);"></div>
  <div style="background:#071a0f;text-align:center;padding:32px 24px;">
    <img src="https://res.cloudinary.com/dvqjgbdhp/image/upload/v1780905905/WhatsApp_Image_2026-06-04_at_3.41.50_PM_saprsh.jpg" alt="LiquorBelle" style="width:60px;border-radius:16px;margin-bottom:12px;">
    <div style="font-size:26px;font-weight:900;color:#fff;">Liquor<span style="color:#2ecc71;">Belle</span></div>
  </div>
  <div style="text-align:center;padding:20px 24px 0;">
    <span style="background:rgba(46,204,113,0.12);color:#2ecc71;padding:8px 20px;border-radius:50px;font-size:11px;font-weight:800;">✅ ORDER DELIVERED SUCCESSFULLY</span>
  </div>
  <div style="padding:20px 28px;">
    <h2 style="color:#fff;font-size:18px;">Hello ${escapeHtml(customerName)},</h2>
    <p style="color:#888;font-size:14px;">🎉 Your order has been successfully delivered! Thank you for choosing LiquorBelle.</p>
    <p style="color:#888;font-size:14px;margin-top:12px;">🍻 We hope you enjoy your drinks. Please don't forget to drink responsibly.</p>
  </div>
  <div style="margin:0 28px;background:#16161f;border-radius:16px;padding:16px;">
    <div style="color:#2ecc71;">📦 ORDER #${escapeHtml(orderId)}</div>
    <table style="width:100%;margin-top:12px;">${itemsHtml}</table>
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid #1e1e2c;text-align:right;"><span style="color:#2ecc71;font-size:18px;font-weight:800;">Total: KES ${(total || 0).toLocaleString()}</span></div>
  </div>
  <div style="padding:20px 28px;text-align:center;">
    <a href="https://teemoreg.github.io/liquorbelle/shop.html" style="background:#2ecc71;color:#fff;padding:12px 32px;border-radius:50px;text-decoration:none;font-weight:800;">🛒 Shop Again</a>
  </div>
  <div style="background:#0d0d14;text-align:center;padding:16px;color:#444;">📞 +254 748 894 443 · WhatsApp 24/7</div>
</div>
</div>
</body>
</html>`;

  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'LiquorBelle', email: 'timblax0@gmail.com' },
      to: [{ email: customerEmail }],
      subject: `✅ Order Delivered - ${orderId} - LiquorBelle`,
      htmlContent: html
    }, { headers: { 'api-key': BREVO_API_KEY } });
    console.log(`📧 Order delivered email sent to ${customerEmail}`);
  } catch (err) { console.error('Email error:', err.message); }
}

// ==================== ADMIN LOGIN (ONLY for admin panel) ====================
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  
  // Get current active passwords
  const activePasswords = await getActivePasswords();
  
  console.log(`Admin login attempt`);
  
  // ONLY allow admin password - NOT cashier password
  if (activePasswords.adminPassword && password === activePasswords.adminPassword) {
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1d' });
    return res.json({ success: true, token, role: 'admin' });
  }
  
  res.status(401).json({ success: false, message: 'Invalid admin password' });
});

// ==================== CASHIER LOGIN (ONLY for order manager) ====================
app.post('/api/cashier/login', async (req, res) => {
  const { password } = req.body;
  
  // Get current active passwords
  const activePasswords = await getActivePasswords();
  
  console.log(`Cashier login attempt`);
  
  // ONLY allow cashier password - NOT admin password
  if (activePasswords.cashierPassword && password === activePasswords.cashierPassword) {
    const token = jwt.sign({ role: 'cashier' }, JWT_SECRET, { expiresIn: '1d' });
    return res.json({ success: true, token, role: 'cashier' });
  }
  
  res.status(401).json({ success: false, message: 'Invalid cashier password' });
});

// ==================== UPDATE PASSWORDS (FIXED) ====================
app.post('/api/admin/update-passwords', requireAdmin, async (req, res) => {
  try {
    const { adminPassword, cashierPassword } = req.body;
    
    // Get current settings to see what's changing
    let currentSettings = await db.collection('admin_settings').findOne({ key: 'passwords' });
    
    // Prepare update object - COMPLETELY REPLACE with new values
    let updateValue = {};
    
    // CRITICAL FIX: When updating a password, we must OVERWRITE it completely
    // NOT try to merge or keep old values
    
    if (adminPassword !== undefined && adminPassword !== '') {
      // User provided a new admin password - use it
      updateValue.adminPassword = adminPassword;
      console.log(`   Admin password updated to new value (old was: ${currentSettings?.value?.adminPassword || 'not set'})`);
    } else {
      // No new admin password provided - keep existing or use env
      updateValue.adminPassword = currentSettings?.value?.adminPassword || ENV_ADMIN_PASSWORD;
    }
    
    if (cashierPassword !== undefined && cashierPassword !== '') {
      // User provided a new cashier password - use it
      updateValue.cashierPassword = cashierPassword;
      console.log(`   Cashier password updated to new value (old was: ${currentSettings?.value?.cashierPassword || 'not set'})`);
    } else {
      // No new cashier password provided - keep existing or use env
      updateValue.cashierPassword = currentSettings?.value?.cashierPassword || CASHIER_PASSWORD;
    }
    
    updateValue.updated_at = new Date();
    
    // COMPLETELY REPLACE the value object in database (no merging)
    await db.collection('admin_settings').updateOne(
      { key: 'passwords' },
      { $set: { value: updateValue, updated_at: new Date() } },
      { upsert: true }
    );
    
    // CRITICAL: Force reload from database to ensure runtime variables match
    const verifySettings = await db.collection('admin_settings').findOne({ key: 'passwords' });
    if (verifySettings && verifySettings.value) {
      activeAdminPassword = verifySettings.value.adminPassword;
      activeCashierPassword = verifySettings.value.cashierPassword;
      passwordsLoaded = true;
      console.log(`   ✓ Verified database - Admin: ${activeAdminPassword ? 'SET' : 'NOT SET'}, Cashier: ${activeCashierPassword ? 'SET' : 'NOT SET'}`);
    } else {
      // Fallback to what we just set
      activeAdminPassword = updateValue.adminPassword;
      activeCashierPassword = updateValue.cashierPassword;
    }
    
    console.log('✅ Passwords updated successfully in database');
    console.log(`   New cashier password is active. Old password will NO LONGER work.`);
    
    res.json({ success: true, message: 'Passwords updated successfully. Old passwords will no longer work.' });
  } catch (err) {
    console.error('Error updating passwords:', err);
    res.status(500).json({ success: false, message: 'Failed to update passwords' });
  }
});

// ==================== PUBLIC ORDER TRACKING ====================
app.get('/api/orders/track', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ success: false, message: 'Email required' });
    if (!isValidEmail(email)) return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
    const orders = await db.collection('orders').find({ customer_email: email.toLowerCase() }).sort({ created_at: -1 }).toArray();
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

// ==================== M-PESA ====================
const CONSUMER_KEY = process.env.CONSUMER_KEY || 'YOUR_CONSUMER_KEY';
const CONSUMER_SECRET = process.env.CONSUMER_SECRET || 'YOUR_CONSUMER_SECRET';
const PASSKEY = process.env.PASSKEY;
const SHORTCODE = process.env.SHORTCODE || '174379';
const baseURL = 'https://sandbox.safaricom.co.ke';

let mpesaAccessToken = null;
let mpesaTokenExpiry = 0;

async function getMpesaAccessToken() {
  if (mpesaAccessToken && Date.now() < mpesaTokenExpiry - 60000) return mpesaAccessToken;
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res = await axios.get(`${baseURL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` }
  });
  mpesaAccessToken = res.data.access_token;
  mpesaTokenExpiry = Date.now() + (res.data.expires_in * 1000);
  return mpesaAccessToken;
}

function formatPhone(phone) {
  let cleaned = phone.toString().replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '254' + cleaned.slice(1);
  if (!cleaned.startsWith('254')) cleaned = '254' + cleaned;
  return cleaned;
}

app.post('/api/stkpush', stkLimiter, async (req, res) => {
  const { phone, orderId, customerName, address, items, subtotal, delivery, total, customerEmail } = req.body;
  const formattedPhone = formatPhone(phone);
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');
  const token = await getMpesaAccessToken();

  await axios.post(`${baseURL}/mpesa/stkpush/v1/processrequest`, {
    BusinessShortCode: SHORTCODE, Password: password, Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline', Amount: Math.round(total),
    PartyA: formattedPhone, PartyB: SHORTCODE, PhoneNumber: formattedPhone,
    CallBackURL: `https://liquorbelle-mpesa-backend.onrender.com/api/callback`,
    AccountReference: orderId, TransactionDesc: `LiquorBelle Order ${orderId}`
  }, { headers: { Authorization: `Bearer ${token}` } });

  await db.collection('pending_orders').insertOne({ orderId, customerName, phone: formattedPhone, address, items, subtotal, delivery, total, customerEmail, created_at: new Date(), paid: false });
  res.json({ success: true });
});

app.post('/api/callback', async (req, res) => {
  const stkCallback = req.body?.Body?.stkCallback;
  if (!stkCallback) return res.json({ ResultCode: 0 });
  const orderId = stkCallback.CallbackMetadata?.Item?.find(i => i.Name === 'AccountReference')?.Value;
  if (stkCallback.ResultCode === 0 && orderId) {
    console.log(`✅ Payment successful for order ${orderId}`);
    const pending = await db.collection('pending_orders').findOne({ orderId });
    if (pending) {
      await db.collection('orders').updateOne(
        { order_number: orderId },
        { $set: { status: 'paid', payment_method: 'M-PESA', updated_at: new Date() } },
        { upsert: true }
      );
      
      await sendMpesaOrderReceivedEmail({
        orderId, customerName: pending.customerName, items: pending.items,
        subtotal: pending.subtotal, delivery: pending.delivery, total: pending.total,
        address: pending.address, phone: pending.phone,
        customerEmail: pending.customerEmail
      });
      
      await db.collection('pending_orders').updateOne({ orderId }, { $set: { paid: true } });
    }
  }
  res.json({ ResultCode: 0 });
});

app.get('/api/status/:orderId', async (req, res) => {
  const pending = await db.collection('pending_orders').findOne({ orderId: req.params.orderId });
  res.json({ status: pending?.paid ? 'paid' : 'pending' });
});

// ==================== ORDER EMAIL ENDPOINTS ====================
app.post('/api/send-order-email', async (req, res) => {
  const { email, orderId, customerName, phone, items, subtotal, delivery, total, address, timestamp, paymentMethod } = req.body;
  if (!BREVO_API_KEY) return res.json({ success: false });
  
  if (paymentMethod === 'cod') {
    await sendCodOrderReceivedEmail({ orderId, customerName, items, subtotal, delivery, total, address, phone, customerEmail: email });
  } else {
    await sendMpesaOrderReceivedEmail({ orderId, customerName, items, subtotal, delivery, total, address, phone, customerEmail: email });
  }
  res.json({ success: true });
});

// ==================== PRODUCT & ORDER CRUD ====================
app.get('/api/db/products', async (req, res) => {
  const products = await db.collection('products').find({}).sort({ created_at: -1 }).toArray();
  res.json({ success: true, products });
});

app.post('/api/db/products', requireAdmin, async (req, res) => {
  const product = { ...req.body, created_at: new Date(), updated_at: new Date() };
  const result = await db.collection('products').insertOne(product);
  res.json({ success: true, product: { _id: result.insertedId, ...product } });
});

app.put('/api/db/products/:id', requireAdmin, async (req, res) => {
  await db.collection('products').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { ...req.body, updated_at: new Date() } });
  res.json({ success: true });
});

app.delete('/api/db/products/:id', requireAdmin, async (req, res) => {
  await db.collection('products').deleteOne({ _id: new ObjectId(req.params.id) });
  res.json({ success: true });
});

app.get('/api/db/orders', requireAdmin, async (req, res) => {
  const orders = await db.collection('orders').find({}).sort({ created_at: -1 }).toArray();
  res.json({ success: true, orders });
});

app.post('/api/db/orders', async (req, res) => {
  const { orderNumber, customerName, customerEmail, phone, address, notes, subtotal, delivery, total, paymentMethod, items } = req.body;
  const order = {
    order_number: orderNumber, customer_name: customerName, customer_email: customerEmail.toLowerCase(),
    phone, address, notes: notes || '', subtotal: subtotal || 0, delivery: delivery || 0, total,
    payment_method: paymentMethod, status: 'pending',
    items: items.map(item => ({ product_name: item.name, ...item, size: item.size || '750ml' })),
    created_at: new Date(), updated_at: new Date()
  };
  const result = await db.collection('orders').insertOne(order);
  
  if (paymentMethod === 'cod') {
    await sendCodOrderReceivedEmail({ orderId: orderNumber, customerName, items, subtotal, delivery, total, address, phone, customerEmail });
  }
  
  res.json({ success: true, order: { _id: result.insertedId, ...order } });
});

app.put('/api/db/orders/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  await db.collection('orders').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status, updated_at: new Date() } });
  
  if (status === 'delivered') {
    const order = await db.collection('orders').findOne({ _id: new ObjectId(req.params.id) });
    if (order && order.customer_email) {
      await sendOrderDeliveredEmail({
        orderId: order.order_number, customerName: order.customer_name,
        items: order.items, total: order.total,
        phone: order.phone, customerEmail: order.customer_email
      });
    }
  }
  res.json({ success: true });
});

app.delete('/api/db/orders/:id', requireAdmin, async (req, res) => {
  await db.collection('orders').deleteOne({ _id: new ObjectId(req.params.id) });
  res.json({ success: true });
});

app.get('/api/db/stats', requireAdmin, async (req, res) => {
  const [totalOrders, totalProducts, revenueResult, pending, paid, delivered] = await Promise.all([
    db.collection('orders').countDocuments(),
    db.collection('products').countDocuments(),
    db.collection('orders').aggregate([{ $match: { status: 'delivered' } }, { $group: { _id: null, total: { $sum: '$total' } } }]).toArray(),
    db.collection('orders').countDocuments({ status: 'pending' }),
    db.collection('orders').countDocuments({ status: 'paid' }),
    db.collection('orders').countDocuments({ status: 'delivered' })
  ]);
  res.json({ success: true, stats: { totalOrders, totalProducts, totalRevenue: revenueResult[0]?.total || 0, pendingOrders: pending, paidOrders: paid, deliveredOrders: delivered } });
});

// ==================== DELIVERY SETTINGS ====================
app.get('/api/delivery-settings', async (req, res) => {
  try {
    const settings = await db.collection('settings').findOne({ key: 'delivery' });
    res.json({ success: true, settings: settings?.value || { delivery_fee: 150, free_delivery_threshold: 3000, delivery_enabled: true } });
  } catch (err) {
    res.json({ success: true, settings: { delivery_fee: 150, free_delivery_threshold: 3000, delivery_enabled: true } });
  }
});

app.get('/api/admin/delivery-settings', requireAdmin, async (req, res) => {
  const settings = await db.collection('settings').findOne({ key: 'delivery' });
  res.json({ success: true, settings: settings?.value || { delivery_fee: 150, free_delivery_threshold: 3000, delivery_enabled: true } });
});

app.post('/api/admin/delivery-settings', requireAdmin, async (req, res) => {
  await db.collection('settings').updateOne({ key: 'delivery' }, { $set: { value: req.body, updated_at: new Date() } }, { upsert: true });
  res.json({ success: true });
});

// ==================== CASHIER/ADMIN ORDERS ENDPOINTS ====================
app.get('/api/admin/all-orders', requireAdminOrCashier, async (req, res) => {
  try {
    const { limit = 1000, status, days } = req.query;
    
    let query = {};
    if (status && status !== 'all') {
      query.status = status;
    }
    if (days && days !== 'all') {
      const daysAgo = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);
      query.created_at = { $gte: daysAgo };
    }
    
    const orders = await db.collection('orders')
      .find(query)
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .toArray();
    
    res.json({ success: true, orders, count: orders.length });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

app.get('/api/admin/recent-orders', requireAdminOrCashier, async (req, res) => {
  try {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orders = await db.collection('orders')
      .find({ created_at: { $gte: last24h } })
      .sort({ created_at: -1 })
      .toArray();
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch recent orders' });
  }
});

app.post('/api/admin/verify', async (req, res) => {
  const { password, type } = req.body;
  const activePasswords = await getActivePasswords();
  
  if (type === 'orders') res.json({ success: password === activePasswords.cashierPassword });
  else res.json({ success: password === activePasswords.adminPassword });
});

// ==================== OTP (for email verification) ====================
app.post('/api/send-email-otp', otpLimiter, async (req, res) => {
  const { email, otp } = req.body;
  if (!isValidEmail(email)) return res.json({ success: false, message: 'Invalid email format' });
  await db.collection('otps').updateOne({ email }, { $set: { otp, created_at: new Date() } }, { upsert: true });
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'LiquorBelle', email: 'timblax0@gmail.com' },
      to: [{ email }],
      subject: 'Your LiquorBelle Verification Code',
      htmlContent: `<div style="text-align:center;padding:40px;"><h2>${otp}</h2><p>Your verification code expires in 10 minutes.</p></div>`
    }, { headers: { 'api-key': BREVO_API_KEY } });
    res.json({ success: true });
  } catch (err) { res.json({ success: false }); }
});

app.post('/api/verify-otp', async (req, res) => {
  const stored = await db.collection('otps').findOne({ email: req.body.email });
  if (!stored || stored.otp !== req.body.otp) return res.json({ success: false });
  await db.collection('otps').deleteOne({ email: req.body.email });
  res.json({ success: true });
});

// ==================== HEALTH ====================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: 'MongoDB', uptime: process.uptime() });
});

// ==================== START ====================
const PORT = process.env.PORT || 3000;
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📧 Email: ${BREVO_API_KEY ? '✅' : '❌'}`);
    console.log(`🗄️ MongoDB: ✅ Connected`);
    console.log(``);
    console.log(`📨 EMAIL FLOW:`);
    console.log(`   COD: Place Order → "Order Received (Rider on way)" | Delivered → "Order Delivered Successfully"`);
    console.log(`   M-PESA: Payment Callback → "Order Received (Rider on way)" | Delivered → "Order Delivered Successfully"`);
    console.log(``);
    console.log(`🧹 AUTO-CLEANUP: Unpaid pending orders older than 35 seconds will be automatically removed`);
    console.log(`👥 ADMIN/CASHIER: SEPARATE login endpoints - admin uses /api/admin/login, cashier uses /api/cashier/login`);
    console.log(`🔐 Passwords stored in MongoDB (admins can change them via Settings tab)`);
    console.log(`⚠️  Only ONE password per role works now (no fallback to old passwords)`);
  });
});
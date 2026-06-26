require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { MongoClient, ObjectId } = require('mongodb');
const NodeCache = require('node-cache');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');

// ==================== CATEGORY CONFIG ====================
const CATEGORIES = {
  beer: 'Beer',
  brandy: 'Brandy',
  bourbon: 'Bourbon',
  rum: 'Rum',
  spirits: 'Spirits',
  liqueur: 'Liqueur',
  juice: 'Juice',
  soda: 'Soda',
  water: 'Water',
  energy: 'Energy Drink',
  cigar: 'Cigar',
  accessory: 'Accessory'
};

const CATEGORY_COLORS = {
  beer: '#F59E0B',
  brandy: '#B8860B',
  bourbon: '#8B4513',
  rum: '#DC2626',
  spirits: '#7C3AED',
  liqueur: '#EC4899',
  juice: '#EF4444',
  soda: '#3B82F6',
  water: '#06B6D4',
  energy: '#F97316',
  cigar: '#92400E',
  accessory: '#6B7280'
};

function getCategoryLabel(category) {
  return CATEGORIES[category] || category || 'Uncategorized';
}

function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || '#6B7280';
}

// ==================== CACHE SETUP ====================
const orderCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });
const productCache = new NodeCache({ stdTTL: 300, checkperiod: 600 });
const statsCache = new NodeCache({ stdTTL: 300, checkperiod: 600 });

// ==================== ENVIRONMENT VALIDATION ====================
if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI env var not set. Refusing to start.');
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET env var not set. Refusing to start.');
  process.exit(1);
}

const app = express();

// ==================== SECURITY MIDDLEWARE ====================
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "https://liquorbelle-mpesa-backend.onrender.com", "https://api.brevo.com", "https://sandbox.safaricom.co.ke"],
      imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://fonts.googleapis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://unpkg.com"],
    },
  },
}));

// ==================== CORS ====================
app.use(cors({
  origin: ['https://teemoreg.github.io', 'http://localhost:3000', 'http://localhost:5500'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ==================== LOGGING ====================
app.use(morgan('combined', {
  skip: (req) => req.path === '/api/health'
}));

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(compression());

// ==================== DEFAULT PASSWORDS ====================
// Allow override from environment variables
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DEFAULT_CASHIER_PASSWORD = process.env.CASHIER_PASSWORD || 'cashier1234';

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

// ==================== JWT ====================
const JWT_SECRET = process.env.JWT_SECRET;

// ==================== MIDDLEWARE ====================
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

// ==================== MONGODB CONNECTION ====================
const MONGODB_URI = process.env.MONGODB_URI;
let db;
let client;

let activeAdminPasswordHash = null;
let activeCashierPasswordHash = null;
let passwordsLoaded = false;

// ==================== FORCE SET DEFAULT PASSWORDS ====================
async function forceSetDefaultPasswords() {
  try {
    if (!db) return;
    
    const adminHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
    const cashierHash = await bcrypt.hash(DEFAULT_CASHIER_PASSWORD, 10);
    
    await db.collection('admin_settings').updateOne(
      { key: 'passwords' },
      { 
        $set: { 
          value: {
            adminPasswordHash: adminHash,
            cashierPasswordHash: cashierHash,
            updated_at: new Date()
          },
          updated_at: new Date()
        } 
      },
      { upsert: true }
    );
    
    activeAdminPasswordHash = adminHash;
    activeCashierPasswordHash = cashierHash;
    passwordsLoaded = true;
    
    console.log('✅ Default passwords set:');
    console.log(`   Admin: ${DEFAULT_ADMIN_PASSWORD}`);
    console.log(`   Cashier: ${DEFAULT_CASHIER_PASSWORD}`);
  } catch (err) {
    console.error('Error setting default passwords:', err);
  }
}

async function loadPasswordsFromDB() {
  try {
    if (!db) {
      console.log('⚠️ DB not connected, waiting...');
      return false;
    }
    const adminSettings = await db.collection('admin_settings').findOne({ key: 'passwords' });
    if (adminSettings && adminSettings.value && adminSettings.value.adminPasswordHash) {
      activeAdminPasswordHash = adminSettings.value.adminPasswordHash;
      activeCashierPasswordHash = adminSettings.value.cashierPasswordHash;
      console.log('✅ Loaded password hashes from database');
      passwordsLoaded = true;
      return true;
    } else {
      await forceSetDefaultPasswords();
      return true;
    }
  } catch (err) {
    console.error('Error loading passwords from DB:', err.message);
    await forceSetDefaultPasswords();
    return false;
  }
}

async function getActivePasswords() {
  if (!passwordsLoaded) {
    await loadPasswordsFromDB();
  }
  return {
    adminPasswordHash: activeAdminPasswordHash,
    cashierPasswordHash: activeCashierPasswordHash
  };
}

// ==================== CLEAR CACHE FUNCTIONS ====================
function clearOrderCache() {
  const keys = orderCache.keys();
  for (const key of keys) {
    if (key.startsWith('orders_') || key.startsWith('all_orders') || key.startsWith('recent_')) {
      orderCache.del(key);
    }
  }
  console.log('🧹 Order cache cleared');
}

function clearProductCache() {
  productCache.del('all_products');
  productCache.del('category_stats');
  console.log('🧹 Product cache cleared');
}

function clearStatsCache() {
  statsCache.del('stats_daily');
  statsCache.del('stats_weekly');
  statsCache.del('stats_monthly');
  statsCache.del('legacy_stats');
  statsCache.del('category_stats');
  console.log('🧹 Stats cache cleared');
}

// ==================== CONNECT DB ====================
async function connectDB() {
  try {
    client = new MongoClient(MONGODB_URI, {
      tls: true,
      tlsAllowInvalidCertificates: false,
      family: 4,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
      minPoolSize: 2,
      maxIdleTimeMS: 30000,
    });
    await client.connect();
    db = client.db('liquorbelle');
    console.log('✅ MongoDB connected (secure TLS)');

    await db.collection('products').createIndex({ name: 1 });
    await db.collection('products').createIndex({ category: 1 });
    await db.collection('orders').createIndex({ customer_email: 1 });
    await db.collection('orders').createIndex({ created_at: -1 });
    await db.collection('orders').createIndex({ status: 1 });
    await db.collection('settings').createIndex({ key: 1 });
    await db.collection('admin_settings').createIndex({ key: 1 });
    await db.collection('pending_orders').createIndex({ created_at: 1 }, { expireAfterSeconds: 3600 });
    await db.collection('otps').createIndex({ created_at: 1 }, { expireAfterSeconds: 600 });
    await db.collection('customers').createIndex({ email: 1 }, { unique: true });

    await loadPasswordsFromDB();

    const productCount = await db.collection('products').countDocuments();
    if (productCount === 0) {
      console.log('📦 No products found. Database ready for imports.');
    } else {
      console.log(`✅ Products already exist (${productCount} products)`);
    }
    console.log('✅ Database ready');
    
    setInterval(() => {
      clearStatsCache();
    }, 24 * 60 * 60 * 1000);
    
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
      } catch (err) {}
    }, 30000);
    
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    console.log('🔄 Retrying connection in 5 seconds...');
    setTimeout(connectDB, 5000);
  }
}

// ==================== ESCAPE HTML ====================
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

const BREVO_API_KEY = process.env.BREVO_API_KEY;

// ==================== EMAIL FUNCTIONS ====================
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
    }, { headers: { 'api-key': BREVO_API_KEY }, timeout: 10000 });
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
    }, { headers: { 'api-key': BREVO_API_KEY }, timeout: 10000 });
    console.log(`📧 Order delivered email sent to ${customerEmail}`);
  } catch (err) { console.error('Email error:', err.message); }
}

// ==================== ADMIN LOGIN ====================
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, message: 'Password required' });
  }
  
  const activePasswords = await getActivePasswords();
  
  console.log(`Admin login attempt`);
  
  if (activePasswords.adminPasswordHash && await bcrypt.compare(password, activePasswords.adminPasswordHash)) {
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1d' });
    return res.json({ success: true, token, role: 'admin' });
  }
  
  res.status(401).json({ success: false, message: 'Invalid admin password' });
});

// ==================== CASHIER LOGIN ====================
app.post('/api/cashier/login', async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, message: 'Password required' });
  }
  
  const activePasswords = await getActivePasswords();
  
  console.log(`Cashier login attempt`);
  
  if (activePasswords.cashierPasswordHash && await bcrypt.compare(password, activePasswords.cashierPasswordHash)) {
    const token = jwt.sign({ role: 'cashier' }, JWT_SECRET, { expiresIn: '1d' });
    return res.json({ success: true, token, role: 'cashier' });
  }
  
  res.status(401).json({ success: false, message: 'Invalid cashier password' });
});

// ==================== UPDATE PASSWORDS ====================
app.post('/api/admin/update-passwords', requireAdmin, async (req, res) => {
  try {
    const { adminPassword, cashierPassword } = req.body;
    let updateValue = {};
    
    if (adminPassword !== undefined && adminPassword !== '') {
      if (adminPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Admin password must be at least 6 characters' });
      }
      updateValue.adminPasswordHash = await bcrypt.hash(adminPassword, 10);
      console.log(`   Admin password updated`);
    }
    
    if (cashierPassword !== undefined && cashierPassword !== '') {
      if (cashierPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Cashier password must be at least 6 characters' });
      }
      updateValue.cashierPasswordHash = await bcrypt.hash(cashierPassword, 10);
      console.log(`   Cashier password updated`);
    }
    
    if (Object.keys(updateValue).length === 0) {
      return res.status(400).json({ success: false, message: 'At least one password required' });
    }
    
    updateValue.updated_at = new Date();
    
    await db.collection('admin_settings').updateOne(
      { key: 'passwords' },
      { $set: { value: updateValue, updated_at: new Date() } },
      { upsert: true }
    );
    
    const verifySettings = await db.collection('admin_settings').findOne({ key: 'passwords' });
    if (verifySettings && verifySettings.value) {
      activeAdminPasswordHash = verifySettings.value.adminPasswordHash;
      activeCashierPasswordHash = verifySettings.value.cashierPasswordHash;
      passwordsLoaded = true;
    }
    
    console.log('✅ Passwords updated successfully');
    res.json({ success: true, message: 'Passwords updated successfully. Old passwords will no longer work.' });
  } catch (err) {
    console.error('Error updating passwords:', err);
    res.status(500).json({ success: false, message: 'Failed to update passwords' });
  }
});

// ==================== ORDER TRACKING WITH OTP ====================
app.post('/api/orders/track', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email required' });
    if (!isValidEmail(email)) return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    
    const stored = await db.collection('otps').findOne({ email: email.toLowerCase() });
    if (!stored || stored.otp !== otp) {
      return res.status(401).json({ success: false, message: 'Invalid OTP' });
    }
    
    await db.collection('otps').deleteOne({ email: email.toLowerCase() });
    
    const cacheKey = 'orders_' + email.toLowerCase();
    const cached = orderCache.get(cacheKey);
    if (cached) {
      return res.json({ success: true, orders: cached, fromCache: true });
    }
    
    const orders = await db.collection('orders').find({ customer_email: email.toLowerCase() }).sort({ created_at: -1 }).toArray();
    orderCache.set(cacheKey, orders);
    res.json({ success: true, orders });
  } catch (err) {
    console.error('Track orders error:', err);
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
  try {
    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
    const res = await axios.get(`${baseURL}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 10000
    });
    mpesaAccessToken = res.data.access_token;
    mpesaTokenExpiry = Date.now() + (res.data.expires_in * 1000);
    return mpesaAccessToken;
  } catch (err) {
    console.error('M-PESA token error:', err.message);
    throw new Error('Failed to get M-PESA access token');
  }
}

function formatPhone(phone) {
  let cleaned = phone.toString().replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '254' + cleaned.slice(1);
  if (!cleaned.startsWith('254')) cleaned = '254' + cleaned;
  return cleaned;
}

app.post('/api/stkpush', stkLimiter, async (req, res) => {
  try {
    const { phone, orderId, customerName, address, items, subtotal, delivery, total, customerEmail } = req.body;
    
    if (!phone || !orderId || !total) {
      return res.status(400).json({ success: false, message: 'Phone, orderId, and total required' });
    }
    
    if (total < 1) {
      return res.status(400).json({ success: false, message: 'Invalid total amount' });
    }
    
    const formattedPhone = formatPhone(phone);
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');
    const token = await getMpesaAccessToken();

    await axios.post(`${baseURL}/mpesa/stkpush/v1/processrequest`, {
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
    }, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000
    });

    await db.collection('pending_orders').insertOne({
      orderId,
      customerName,
      phone: formattedPhone,
      address,
      items,
      subtotal,
      delivery,
      total,
      customerEmail,
      created_at: new Date(),
      paid: false
    });
    
    res.json({ success: true });
  } catch (err) {
    console.error('STK Push error:', err.message);
    res.status(500).json({ success: false, message: 'Payment request failed: ' + err.message });
  }
});

app.post('/api/callback', async (req, res) => {
  try {
    const stkCallback = req.body?.Body?.stkCallback;
    if (!stkCallback) {
      return res.json({ ResultCode: 0 });
    }
    
    const orderId = stkCallback.CallbackMetadata?.Item?.find(i => i.Name === 'AccountReference')?.Value;
    
    if (stkCallback.ResultCode === 0 && orderId) {
      console.log(`✅ Payment successful for order ${orderId}`);
      
      const pending = await db.collection('pending_orders').findOne({ orderId });
      if (pending) {
        await db.collection('orders').updateOne(
          { order_number: orderId },
          { 
            $set: { 
              status: 'paid', 
              payment_method: 'M-PESA', 
              updated_at: new Date() 
            } 
          },
          { upsert: true }
        );
        
        await sendMpesaOrderReceivedEmail({
          orderId,
          customerName: pending.customerName,
          items: pending.items,
          subtotal: pending.subtotal,
          delivery: pending.delivery,
          total: pending.total,
          address: pending.address,
          phone: pending.phone,
          customerEmail: pending.customerEmail
        });
        
        await db.collection('pending_orders').updateOne(
          { orderId },
          { $set: { paid: true } }
        );
        
        clearOrderCache();
        if (pending.customerEmail) {
          orderCache.del('orders_' + pending.customerEmail.toLowerCase());
        }
      }
    } else {
      console.log(`❌ Payment failed for order ${orderId}: ${stkCallback.ResultDesc}`);
    }
    
    res.json({ ResultCode: 0 });
  } catch (err) {
    console.error('Callback error:', err);
    res.json({ ResultCode: 0 });
  }
});

app.get('/api/status/:orderId', async (req, res) => {
  try {
    const pending = await db.collection('pending_orders').findOne({ orderId: req.params.orderId });
    const order = await db.collection('orders').findOne({ order_number: req.params.orderId });
    
    if (order) {
      res.json({ status: order.status || 'pending' });
    } else if (pending) {
      res.json({ status: pending.paid ? 'paid' : 'pending' });
    } else {
      res.json({ status: 'not_found' });
    }
  } catch (err) {
    res.json({ status: 'pending' });
  }
});

// ==================== ORDER EMAIL ENDPOINTS ====================
app.post('/api/send-order-email', async (req, res) => {
  const { email, orderId, customerName, phone, items, subtotal, delivery, total, address, timestamp, paymentMethod } = req.body;
  if (!BREVO_API_KEY) return res.json({ success: false });
  
  await sendMpesaOrderReceivedEmail({ 
    orderId, 
    customerName, 
    items, 
    subtotal, 
    delivery, 
    total, 
    address, 
    phone, 
    customerEmail: email 
  });
  res.json({ success: true });
});

// ==================== PRODUCT CRUD ====================
app.get('/api/db/products', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting... Please try again in a moment.' 
      });
    }
    
    const cached = productCache.get('all_products');
    if (cached) {
      return res.json({ success: true, products: cached, fromCache: true });
    }
    
    const products = await db.collection('products').find({}).sort({ created_at: -1 }).toArray();
    productCache.set('all_products', products);
    res.json({ success: true, products });
  } catch (err) {
    console.error('Error fetching products:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

app.post('/api/db/products', requireAdmin, [
  body('name').notEmpty().withMessage('Product name required'),
  body('variants').isArray({ min: 1 }).withMessage('At least one variant required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    
    // Validate variants
    for (const v of req.body.variants) {
      if (!v.size || !v.price || v.price <= 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'Each variant must have size and positive price' 
        });
      }
    }
    
    const product = { ...req.body, created_at: new Date(), updated_at: new Date() };
    const result = await db.collection('products').insertOne(product);
    clearProductCache();
    clearStatsCache();
    res.json({ success: true, product: { _id: result.insertedId, ...product } });
  } catch (err) {
    console.error('Error creating product:', err);
    res.status(500).json({ success: false, message: 'Failed to create product' });
  }
});

app.put('/api/db/products/:id', requireAdmin, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    
    const { id } = req.params;
    const updateData = { ...req.body, updated_at: new Date() };
    
    // Validate variants if present
    if (updateData.variants) {
      if (!Array.isArray(updateData.variants) || updateData.variants.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'Variants must be a non-empty array' 
        });
      }
      for (const v of updateData.variants) {
        if (!v.size || !v.price || v.price <= 0) {
          return res.status(400).json({ 
            success: false, 
            message: 'Each variant must have size and positive price' 
          });
        }
      }
    }
    
    const result = await db.collection('products').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    clearProductCache();
    clearStatsCache();
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ success: false, message: 'Failed to update product' });
  }
});

app.delete('/api/db/products/:id', requireAdmin, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    
    const result = await db.collection('products').deleteOne({ _id: new ObjectId(req.params.id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    clearProductCache();
    clearStatsCache();
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ success: false, message: 'Failed to delete product' });
  }
});

// ==================== CLEAR ALL PRODUCTS ====================
app.delete('/api/db/products/clear', requireAdmin, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    const result = await db.collection('products').deleteMany({});
    clearProductCache();
    clearStatsCache();
    res.json({ success: true, deletedCount: result.deletedCount, message: `Deleted ${result.deletedCount} products` });
  } catch (err) {
    console.error('Error clearing products:', err);
    res.status(500).json({ success: false, message: 'Failed to clear products' });
  }
});

// ==================== CATEGORY STATS ====================
app.get('/api/admin/category-stats', requireAdmin, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false });
    
    const cached = statsCache.get('category_stats');
    if (cached) {
      return res.json({ success: true, stats: cached, fromCache: true });
    }
    
    const products = await db.collection('products').find({}).toArray();
    const stats = {};
    
    Object.keys(CATEGORIES).forEach(cat => {
      stats[cat] = { count: 0, label: CATEGORIES[cat], color: CATEGORY_COLORS[cat] };
    });
    
    products.forEach(product => {
      const cat = product.category || 'uncategorized';
      if (stats[cat]) {
        stats[cat].count++;
      } else {
        stats[cat] = { count: 1, label: cat, color: '#6B7280' };
      }
    });
    
    statsCache.set('category_stats', stats);
    res.json({ success: true, stats });
  } catch (err) {
    console.error('Error fetching category stats:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch category stats' });
  }
});

// ==================== GOOGLE SHEETS INTEGRATION ====================
const GOOGLE_SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
const GOOGLE_SHEETS_SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

// 1. IMPORT from Google Sheets
app.post('/api/admin/import-sheet', requireAdmin, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    
    const { spreadsheetId, range, sheetName } = req.body;
    const sheetId = spreadsheetId || GOOGLE_SHEETS_SPREADSHEET_ID;
    const sheetRange = range || 'Sheet1!A1:Z1000';
    
    if (!GOOGLE_SHEETS_API_KEY) {
      return res.status(400).json({ 
        success: false, 
        message: 'Google Sheets API key not configured. Set GOOGLE_SHEETS_API_KEY in environment variables.' 
      });
    }
    
    if (!sheetId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Spreadsheet ID required. Provide in request or set GOOGLE_SHEETS_SPREADSHEET_ID.' 
      });
    }
    
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetRange}?key=${GOOGLE_SHEETS_API_KEY}`;
    const response = await axios.get(url, { timeout: 30000 });
    
    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return res.status(400).json({ success: false, message: 'No data found in sheet' });
    }
    
    const headers = rows[0].map(h => h.trim().toLowerCase());
    const imported = [];
    const errors = [];
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = row[j] || '';
      }
      
      if (!obj.name && !obj['product name']) continue;
      
      try {
        const product = {
          name: obj.name || obj['product name'] || '',
          category: obj.category || obj['category'] || 'beer',
          badge: obj.badge || obj['badge'] || '',
          image: obj.image || obj['image url'] || obj['image_url'] || '',
          description: obj.description || obj['description'] || '',
          isTrending: (obj.trending || obj['is trending'] || obj['is_trending'] || '').toLowerCase() === 'true' || false,
          isNew: (obj.new || obj['is new'] || obj['is_new'] || '').toLowerCase() === 'true' || false,
          rating: parseFloat(obj.rating || obj['rating'] || 4) || 4,
          variants: []
        };
        
        for (let k = 1; k <= 10; k++) {
          const sizeKey = 'size' + k;
          const priceKey = 'price' + k;
          const discountKey = 'discount' + k;
          
          let size = obj[sizeKey] || obj['Size' + k] || obj['SIZE' + k] || '';
          let price = parseFloat(obj[priceKey] || obj['Price' + k] || obj['PRICE' + k] || 0);
          let discount = parseInt(obj[discountKey] || obj['Discount' + k] || obj['DISCOUNT' + k] || 0);
          
          if (size && price > 0) {
            product.variants.push({ size, price, discount });
          }
        }
        
        if (product.variants.length === 0) {
          const size = obj.size || obj['Size'] || obj['SIZE'] || '750ml';
          const price = parseFloat(obj.price || obj['Price'] || obj['PRICE'] || 0);
          const discount = parseInt(obj.discount || obj['Discount'] || obj['DISCOUNT'] || 0);
          if (price > 0) {
            product.variants.push({ size, price, discount });
          }
        }
        
        if (product.variants.length === 0) {
          errors.push(`Row ${i+1}: No variants found for "${product.name}"`);
          continue;
        }
        
        if (!product.name) {
          errors.push(`Row ${i+1}: Missing product name`);
          continue;
        }
        
        product.created_at = new Date();
        product.updated_at = new Date();
        const result = await db.collection('products').insertOne(product);
        imported.push({ ...product, _id: result.insertedId });
        
      } catch (err) {
        errors.push(`Row ${i+1}: ${err.message}`);
      }
    }
    
    clearProductCache();
    clearStatsCache();
    
    res.json({ 
      success: true, 
      imported: imported.length, 
      errors: errors,
      products: imported,
      message: `Imported ${imported.length} products${errors.length > 0 ? `, ${errors.length} errors` : ''}`
    });
    
  } catch (err) {
    console.error('Google Sheets import error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to import from Google Sheets: ' + err.message });
  }
});

// 2. EXPORT products to CSV
app.get('/api/admin/export-sheet', requireAdmin, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    
    const products = await db.collection('products').find({}).sort({ created_at: -1 }).toArray();
    
    let csv = 'Name,Category,Badge,Image,Description,Trending,New,Rating';
    
    let maxVariants = 0;
    products.forEach(p => {
      if (p.variants && p.variants.length > maxVariants) {
        maxVariants = p.variants.length;
      }
    });
    
    for (let i = 1; i <= maxVariants; i++) {
      csv += `,Size${i},Price${i},Discount${i}`;
    }
    csv += '\n';
    
    products.forEach(p => {
      let row = `"${(p.name || '').replace(/"/g, '""')}",`;
      row += `"${(p.category || '').replace(/"/g, '""')}",`;
      row += `"${(p.badge || '').replace(/"/g, '""')}",`;
      row += `"${(p.image || '').replace(/"/g, '""')}",`;
      row += `"${(p.description || '').replace(/"/g, '""')}",`;
      row += `${p.isTrending ? 'TRUE' : 'FALSE'},`;
      row += `${p.isNew ? 'TRUE' : 'FALSE'},`;
      row += `${p.rating || 4}`;
      
      if (p.variants) {
        p.variants.forEach(v => {
          row += `,${v.size},${v.price},${v.discount || 0}`;
        });
        for (let i = p.variants.length; i < maxVariants; i++) {
          row += ',,'; 
        }
      }
      csv += row + '\n';
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=liquorbelle_products_export.csv');
    res.send(csv);
    
  } catch (err) {
    console.error('Export error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to export products' });
  }
});

// 3. GET sheet info
app.get('/api/admin/sheet-info', requireAdmin, async (req, res) => {
  try {
    if (!GOOGLE_SHEETS_API_KEY) {
      return res.status(400).json({ 
        success: false, 
        message: 'Google Sheets API key not configured' 
      });
    }
    
    const sheetId = req.query.spreadsheetId || GOOGLE_SHEETS_SPREADSHEET_ID;
    if (!sheetId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Spreadsheet ID required' 
      });
    }
    
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${GOOGLE_SHEETS_API_KEY}`;
    const response = await axios.get(url, { timeout: 10000 });
    
    const sheets = response.data.sheets.map(s => ({
      name: s.properties.title,
      sheetId: s.properties.sheetId,
      index: s.properties.index
    }));
    
    res.json({ success: true, sheets });
    
  } catch (err) {
    console.error('Sheet info error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get sheet info: ' + err.message });
  }
});

// ==================== ORDERS ====================
app.get('/api/db/orders', requireAdmin, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    
    const cached = orderCache.get('all_orders');
    if (cached) {
      return res.json({ success: true, orders: cached, fromCache: true });
    }
    
    const orders = await db.collection('orders').find({}).sort({ created_at: -1 }).toArray();
    orderCache.set('all_orders', orders);
    res.json({ success: true, orders });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

app.post('/api/db/orders', requireAdminOrCashier, [
  body('orderNumber').notEmpty().withMessage('Order number required'),
  body('customerName').notEmpty().withMessage('Customer name required'),
  body('customerEmail').isEmail().withMessage('Valid email required'),
  body('phone').notEmpty().withMessage('Phone required'),
  body('address').notEmpty().withMessage('Address required'),
  body('total').isNumeric().withMessage('Total must be a number'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    const { orderNumber, customerName, customerEmail, phone, address, notes, subtotal, delivery, total, items } = req.body;
    
    const order = {
      order_number: orderNumber,
      customer_name: customerName,
      customer_email: customerEmail.toLowerCase(),
      phone,
      address,
      notes: notes || '',
      subtotal: subtotal || 0,
      delivery: delivery || 0,
      total,
      payment_method: 'M-PESA',
      status: 'pending',
      items: items.map(item => ({ product_name: item.name, ...item, size: item.size || '750ml' })),
      created_at: new Date(),
      updated_at: new Date()
    };
    const result = await db.collection('orders').insertOne(order);
    
    clearOrderCache();
    if (customerEmail) {
      const cacheKey = 'orders_' + customerEmail.toLowerCase();
      orderCache.del(cacheKey);
    }
    
    res.json({ success: true, order: { _id: result.insertedId, ...order } });
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
});

// ==================== ADMIN ORDER STATUS UPDATE ====================
app.put('/api/db/orders/:id/status', requireAdmin, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    const { status } = req.body;
    
    if (!['pending', 'paid', 'delivered'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    
    const result = await db.collection('orders').updateOne(
      { _id: new ObjectId(req.params.id) }, 
      { $set: { status, updated_at: new Date() } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    clearOrderCache();
    
    if (status === 'delivered') {
      const order = await db.collection('orders').findOne({ _id: new ObjectId(req.params.id) });
      if (order && order.customer_email) {
        await sendOrderDeliveredEmail({
          orderId: order.order_number,
          customerName: order.customer_name,
          items: order.items,
          total: order.total,
          phone: order.phone,
          customerEmail: order.customer_email
        });
        const cacheKey = 'orders_' + order.customer_email.toLowerCase();
        orderCache.del(cacheKey);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
});

// ==================== CASHIER ORDER STATUS UPDATE ====================
app.put('/api/cashier/orders/:id/status', requireAdminOrCashier, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    const { status } = req.body;
    
    if (!['pending', 'paid', 'delivered'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    
    const result = await db.collection('orders').updateOne(
      { _id: new ObjectId(req.params.id) }, 
      { $set: { status, updated_at: new Date() } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    clearOrderCache();
    
    if (status === 'delivered') {
      const order = await db.collection('orders').findOne({ _id: new ObjectId(req.params.id) });
      if (order && order.customer_email) {
        await sendOrderDeliveredEmail({
          orderId: order.order_number, 
          customerName: order.customer_name,
          items: order.items, 
          total: order.total,
          phone: order.phone, 
          customerEmail: order.customer_email
        });
        const cacheKey = 'orders_' + order.customer_email.toLowerCase();
        orderCache.del(cacheKey);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
});

app.delete('/api/db/orders/:id', requireAdmin, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    const order = await db.collection('orders').findOne({ _id: new ObjectId(req.params.id) });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    await db.collection('orders').deleteOne({ _id: new ObjectId(req.params.id) });
    clearOrderCache();
    if (order && order.customer_email) {
      const cacheKey = 'orders_' + order.customer_email.toLowerCase();
      orderCache.del(cacheKey);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting order:', err);
    res.status(500).json({ success: false, message: 'Failed to delete order' });
  }
});

// ==================== SALES REPORTS ====================
async function generateReport(period) {
  const now = new Date();
  let startDate;
  
  switch(period) {
    case 'daily':
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'weekly':
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 7);
      break;
    case 'monthly':
      startDate = new Date(now);
      startDate.setMonth(now.getMonth() - 1);
      break;
    default:
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
  }
  
  const [totalOrders, revenueResult, deliveredResult] = await Promise.all([
    db.collection('orders').countDocuments({ created_at: { $gte: startDate } }),
    db.collection('orders').aggregate([
      { $match: { created_at: { $gte: startDate }, status: 'delivered' } },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]).toArray(),
    db.collection('orders').aggregate([
      { $match: { created_at: { $gte: startDate }, status: 'delivered' } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }, count: { $sum: 1 }, revenue: { $sum: '$total' } } },
      { $sort: { _id: 1 } }
    ]).toArray()
  ]);
  
  return {
    period,
    startDate,
    endDate: now,
    totalOrders,
    totalRevenue: revenueResult[0]?.total || 0,
    deliveredCount: deliveredResult.reduce((sum, d) => sum + d.count, 0),
    breakdown: deliveredResult
  };
}

app.get('/api/admin/reports/daily', requireAdminOrCashier, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    
    const cached = statsCache.get('stats_daily');
    if (cached) {
      return res.json({ success: true, report: cached, fromCache: true });
    }
    
    const report = await generateReport('daily');
    statsCache.set('stats_daily', report);
    res.json({ success: true, report });
  } catch (err) {
    console.error('Error generating daily report:', err);
    res.status(500).json({ success: false, message: 'Failed to generate report' });
  }
});

app.get('/api/admin/reports/weekly', requireAdminOrCashier, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    
    const cached = statsCache.get('stats_weekly');
    if (cached) {
      return res.json({ success: true, report: cached, fromCache: true });
    }
    
    const report = await generateReport('weekly');
    statsCache.set('stats_weekly', report);
    res.json({ success: true, report });
  } catch (err) {
    console.error('Error generating weekly report:', err);
    res.status(500).json({ success: false, message: 'Failed to generate report' });
  }
});

app.get('/api/admin/reports/monthly', requireAdminOrCashier, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    
    const cached = statsCache.get('stats_monthly');
    if (cached) {
      return res.json({ success: true, report: cached, fromCache: true });
    }
    
    const report = await generateReport('monthly');
    statsCache.set('stats_monthly', report);
    res.json({ success: true, report });
  } catch (err) {
    console.error('Error generating monthly report:', err);
    res.status(500).json({ success: false, message: 'Failed to generate report' });
  }
});

// ==================== LEGACY STATS ====================
app.get('/api/db/stats', requireAdmin, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    
    const cached = statsCache.get('legacy_stats');
    if (cached) {
      return res.json({ success: true, stats: cached, fromCache: true });
    }
    
    const [totalOrders, totalProducts, revenueResult, pending, paid, delivered] = await Promise.all([
      db.collection('orders').countDocuments(),
      db.collection('products').countDocuments(),
      db.collection('orders').aggregate([{ $match: { status: 'delivered' } }, { $group: { _id: null, total: { $sum: '$total' } } }]).toArray(),
      db.collection('orders').countDocuments({ status: 'pending' }),
      db.collection('orders').countDocuments({ status: 'paid' }),
      db.collection('orders').countDocuments({ status: 'delivered' })
    ]);
    
    const stats = { 
      totalOrders, 
      totalProducts, 
      totalRevenue: revenueResult[0]?.total || 0, 
      pendingOrders: pending, 
      paidOrders: paid, 
      deliveredOrders: delivered 
    };
    statsCache.set('legacy_stats', stats);
    res.json({ success: true, stats });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});

// ==================== DELIVERY SETTINGS ====================
app.get('/api/delivery-settings', async (req, res) => {
  try {
    if (!db) return res.json({ success: true, settings: { delivery_fee: 150, free_delivery_threshold: 3000, delivery_enabled: true } });
    const settings = await db.collection('settings').findOne({ key: 'delivery' });
    res.json({ success: true, settings: settings?.value || { delivery_fee: 150, free_delivery_threshold: 3000, delivery_enabled: true } });
  } catch (err) {
    res.json({ success: true, settings: { delivery_fee: 150, free_delivery_threshold: 3000, delivery_enabled: true } });
  }
});

app.get('/api/admin/delivery-settings', requireAdmin, async (req, res) => {
  try {
    if (!db) return res.json({ success: true, settings: { delivery_fee: 150, free_delivery_threshold: 3000, delivery_enabled: true } });
    const settings = await db.collection('settings').findOne({ key: 'delivery' });
    res.json({ success: true, settings: settings?.value || { delivery_fee: 150, free_delivery_threshold: 3000, delivery_enabled: true } });
  } catch (err) {
    res.json({ success: true, settings: { delivery_fee: 150, free_delivery_threshold: 3000, delivery_enabled: true } });
  }
});

app.post('/api/admin/delivery-settings', requireAdmin, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    
    const { delivery_fee, free_delivery_threshold, delivery_enabled } = req.body;
    await db.collection('settings').updateOne(
      { key: 'delivery' },
      { 
        $set: { 
          value: { 
            delivery_fee: delivery_fee || 0, 
            free_delivery_threshold: free_delivery_threshold || 0, 
            delivery_enabled: delivery_enabled !== false 
          }, 
          updated_at: new Date() 
        } 
      },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving delivery settings:', err);
    res.status(500).json({ success: false, message: 'Failed to update delivery settings' });
  }
});

// ==================== CASHIER/ADMIN ORDERS ENDPOINTS ====================
app.get('/api/admin/all-orders', requireAdminOrCashier, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    const { limit = 1000, status, days } = req.query;
    
    const cacheKey = 'all_orders_' + (status || 'all') + '_' + (days || 'all');
    const cached = orderCache.get(cacheKey);
    if (cached) {
      return res.json({ success: true, orders: cached, count: cached.length, fromCache: true });
    }
    
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
    
    orderCache.set(cacheKey, orders);
    res.json({ success: true, orders, count: orders.length });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

app.get('/api/admin/recent-orders', requireAdminOrCashier, async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    const cached = orderCache.get('recent_orders');
    if (cached) {
      return res.json({ success: true, orders: cached, fromCache: true });
    }
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orders = await db.collection('orders')
      .find({ created_at: { $gte: last24h } })
      .sort({ created_at: -1 })
      .toArray();
    orderCache.set('recent_orders', orders);
    res.json({ success: true, orders });
  } catch (err) {
    console.error('Error fetching recent orders:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch recent orders' });
  }
});

app.post('/api/admin/verify', async (req, res) => {
  const { password, type } = req.body;
  const activePasswords = await getActivePasswords();
  
  if (type === 'orders') {
    const valid = activePasswords.cashierPasswordHash && await bcrypt.compare(password, activePasswords.cashierPasswordHash);
    res.json({ success: valid });
  } else {
    const valid = activePasswords.adminPasswordHash && await bcrypt.compare(password, activePasswords.adminPasswordHash);
    res.json({ success: valid });
  }
});

// ==================== CUSTOMER MANAGEMENT ====================
app.post('/api/customers/register', [
  body('email').isEmail().withMessage('Valid email required'),
  body('name').notEmpty().withMessage('Name required'),
  body('phone').notEmpty().withMessage('Phone required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    const { email, name, phone, address } = req.body;
    
    const existing = await db.collection('customers').findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.json({ success: true, customer: existing, message: 'Customer already exists' });
    }
    
    const customer = {
      email: email.toLowerCase(),
      name,
      phone,
      address: address || '',
      orderHistory: [],
      favorites: [],
      created_at: new Date(),
      updated_at: new Date()
    };
    
    await db.collection('customers').insertOne(customer);
    res.json({ success: true, customer });
  } catch (err) {
    console.error('Error registering customer:', err);
    res.status(500).json({ success: false, message: 'Failed to register customer' });
  }
});

app.get('/api/customers/:email', async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    const customer = await db.collection('customers').findOne({ email: req.params.email.toLowerCase() });
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    res.json({ success: true, customer });
  } catch (err) {
    console.error('Error fetching customer:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch customer' });
  }
});

app.put('/api/customers/:email/favorites', async (req, res) => {
  try {
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });
    const { productId } = req.body;
    const customer = await db.collection('customers').findOne({ email: req.params.email.toLowerCase() });
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    
    const favorites = customer.favorites || [];
    const index = favorites.indexOf(productId);
    if (index > -1) {
      favorites.splice(index, 1);
    } else {
      favorites.push(productId);
    }
    
    await db.collection('customers').updateOne(
      { email: req.params.email.toLowerCase() },
      { $set: { favorites, updated_at: new Date() } }
    );
    res.json({ success: true, favorites });
  } catch (err) {
    console.error('Error updating favorites:', err);
    res.status(500).json({ success: false, message: 'Failed to update favorites' });
  }
});

// ==================== OTP ====================
app.post('/api/send-email-otp', otpLimiter, async (req, res) => {
  const { email, otp } = req.body;
  if (!isValidEmail(email)) return res.json({ success: false, message: 'Invalid email format' });
  if (!db) return res.json({ success: false, message: 'Database connecting...' });
  await db.collection('otps').updateOne({ email }, { $set: { otp, created_at: new Date() } }, { upsert: true });
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'LiquorBelle', email: 'timblax0@gmail.com' },
      to: [{ email }],
      subject: 'Your LiquorBelle Verification Code',
      htmlContent: `<div style="text-align:center;padding:40px;"><h2>${otp}</h2><p>Your verification code expires in 10 minutes.</p></div>`
    }, { headers: { 'api-key': BREVO_API_KEY }, timeout: 10000 });
    res.json({ success: true });
  } catch (err) { 
    console.error('OTP email error:', err.message);
    res.json({ success: false }); 
  }
});

app.post('/api/verify-otp', async (req, res) => {
  if (!db) return res.json({ success: false, message: 'Database connecting...' });
  const stored = await db.collection('otps').findOne({ email: req.body.email });
  if (!stored || stored.otp !== req.body.otp) return res.json({ success: false });
  await db.collection('otps').deleteOne({ email: req.body.email });
  res.json({ success: true });
});

// ==================== HEALTH ====================
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    database: db ? 'connected' : 'disconnected', 
    uptime: process.uptime(),
    categories: Object.keys(CATEGORIES),
    cache: {
      orders: orderCache.keys().length,
      products: productCache.keys().length,
      stats: statsCache.keys().length
    }
  });
});

// ==================== START ====================
const PORT = process.env.PORT || 10000;
connectDB().then(() => {
  // ✅ FIXED: Bind to 0.0.0.0 so Render can detect the open port
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📧 Email: ${BREVO_API_KEY ? '✅' : '❌'}`);
    console.log(`🗄️ MongoDB: ${db ? '✅ Connected (secure TLS)' : '❌ Not connected'}`);
    console.log(`📊 Google Sheets: ${GOOGLE_SHEETS_API_KEY ? '✅ Configured' : '❌ Not configured (set GOOGLE_SHEETS_API_KEY to enable)'}`);
    console.log(``);
    console.log(`📂 CATEGORIES (12):`);
    Object.keys(CATEGORIES).forEach(cat => {
      console.log(`   ${cat}: ${CATEGORIES[cat]}`);
    });
    console.log(``);
    console.log(`🔑 DEFAULT PASSWORDS:`);
    console.log(`   Admin (admin-full.html): ${DEFAULT_ADMIN_PASSWORD}`);
    console.log(`   Cashier (admin-orders.html): ${DEFAULT_CASHIER_PASSWORD}`);
    console.log(``);
    console.log(`🔒 SECURITY:`);
    console.log(`   ✅ Helmet security headers enabled`);
    console.log(`   ✅ CORS configured with allowed origins`);
    console.log(`   ✅ Rate limiting enabled`);
    console.log(`   ✅ Passwords stored as bcrypt hashes`);
    console.log(`   ✅ TLS certificate validation ENABLED`);
    console.log(`   ✅ Order creation requires authentication`);
    console.log(`   ✅ Express Validator enabled`);
    console.log(`   ✅ Order tracking requires OTP`);
    console.log(`   ✅ bcryptjs used (pure JS, no native vulnerabilities)`);
    console.log(``);
    console.log(`⚡ CACHE ENABLED:`);
    console.log(`   Products: 5 minutes (TTL)`);
    console.log(`   Orders: 1 minute (TTL)`);
    console.log(`   Stats: 5 minutes (TTL)`);
    console.log(`   Daily stats auto-refresh every 24 hours`);
    console.log(`   Connection pool: min 2, max 10`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
});

// ==================== GRACEFUL SHUTDOWN ====================
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, closing server...');
  if (client) {
    await client.close();
    console.log('✅ MongoDB connection closed');
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, closing server...');
  if (client) {
    await client.close();
    console.log('✅ MongoDB connection closed');
  }
  process.exit(0);
});
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ==================== ENVIRONMENT VALIDATION ====================
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET env var not set. Refusing to start.');
  process.exit(1);
}
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
app.use(express.json());

// ==================== JWT CONFIG ====================
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = '7d';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const CASHIER_PASSWORD = process.env.CASHIER_PASSWORD || 'cashier123';

// ==================== RATE LIMITING ====================
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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const orderCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many orders placed. Please wait.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many admin requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', generalLimiter);
app.use('/api/send-email-otp', otpLimiter);
app.use('/api/stkpush', stkLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/delete', authLimiter);
app.use('/api/db/orders', orderCreateLimiter);
app.use('/api/db/', adminLimiter);
app.use('/api/admin/', adminLimiter);

// ==================== AUTH MIDDLEWARE ====================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token required' });
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
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

async function connectDB() {
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('liquorbelle');
    console.log('✅ MongoDB connected');

    // Create indexes
    await db.collection('products').createIndex({ name: 1 });
    await db.collection('orders').createIndex({ customer_email: 1 });
    await db.collection('orders').createIndex({ created_at: -1 });
    await db.collection('settings').createIndex({ key: 1 });
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('pending_orders').createIndex({ created_at: 1 }, { expireAfterSeconds: 3600 });
    await db.collection('otps').createIndex({ created_at: 1 }, { expireAfterSeconds: 600 });

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
          isTrending: true,
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
          isTrending: true,
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
          isTrending: true,
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
          isTrending: true,
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
          isTrending: true,
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
          isTrending: true,
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
          isTrending: true,
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
          isTrending: true,
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
          isTrending: true,
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
          isTrending: false,
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

// ==================== HELPER FUNCTIONS ====================
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// SVG icons inline for emails (email-safe)
const icons = {
  clock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`,
  pin: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  phone: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.77 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.7 2.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6.09 6.09l1.08-.78a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  truck: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  bag: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
  search: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  lock: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  warn: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
};

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
    phone,
    customerEmail
  } = orderData;

  const accent = isPaymentConfirmed ? '#2ecc71' : '#e03131';
  const accentDim = isPaymentConfirmed ? 'rgba(46,204,113,0.12)' : 'rgba(224,49,49,0.12)';
  const accentBorder = isPaymentConfirmed ? 'rgba(46,204,113,0.25)' : 'rgba(224,49,49,0.25)';
  const headerBg = isPaymentConfirmed ? 'linear-gradient(135deg,#071a0f 0%,#0f0f18 100%)' : 'linear-gradient(135deg,#1a0808 0%,#0f0f18 100%)';
  const statusIcon = isPaymentConfirmed ? icons.check : icons.clock;
  const statusLabel = isPaymentConfirmed ? 'PAYMENT CONFIRMED' : 'ORDER RECEIVED';
  const deliveryText = delivery === 0 ? '<span style="color:#2ecc71;font-weight:800;">FREE</span>' : `<span style="color:#f0a500;font-weight:800;">KES ${delivery.toLocaleString()}</span>`;
  const paymentLabel = paymentMethod === 'mpesa' ? 'M-PESA' : 'Cash on Delivery';

  const itemsHtml = (items || []).map(item => `
    <tr>
      <td style="padding:13px 20px;border-bottom:1px solid #1c1c28;">
        <div style="color:#e0e0e0;font-size:14px;font-weight:600;">${escapeHtml(item.name)}</div>
        <div style="color:#555;font-size:12px;margin-top:3px;">${escapeHtml(item.size || '750ml')} &nbsp;·&nbsp; ×${item.qty}</div>
       </td>
      <td style="padding:13px 20px;text-align:right;border-bottom:1px solid #1c1c28;color:#f0a500;font-weight:800;font-size:15px;white-space:nowrap;">KES ${(item.price * item.qty).toLocaleString()}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${isPaymentConfirmed ? '✅ Payment Confirmed' : '📦 Order Confirmed'} - LiquorBelle</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:580px;margin:0 auto;padding:20px;">
<div style="background:linear-gradient(160deg,#111118 0%,#0f0f17 100%);border-radius:24px;overflow:hidden;border:1px solid #1e1e2c;box-shadow:0 20px 60px rgba(0,0,0,0.6);">

  <!-- TOP ACCENT BAR -->
  <div style="height:3px;background:linear-gradient(90deg,${accent},#f0a500,${accent});"></div>

  <!-- HEADER -->
  <div style="background:${headerBg};text-align:center;padding:32px 24px 24px;border-bottom:1px solid #1a1a28;">
    <img src="https://res.cloudinary.com/dvqjgbdhp/image/upload/v1780905905/WhatsApp_Image_2026-06-04_at_3.41.50_PM_saprsh.jpg" alt="LiquorBelle" style="width:62px;height:62px;border-radius:16px;margin-bottom:14px;box-shadow:0 8px 24px ${accentBorder};">
    <div style="font-size:26px;font-weight:900;color:#fff;letter-spacing:-0.5px;">Liquor<span style="color:${accent};">Belle</span></div>
    <div style="margin-top:8px;color:#666;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">Dagoretti's Finest &nbsp;·&nbsp; 24/7 Delivery</div>
  </div>

  <!-- STATUS BADGE -->
  <div style="text-align:center;padding:26px 24px 0;">
    <span style="display:inline-block;background:${accentDim};color:${accent};padding:9px 22px;border-radius:50px;font-size:11px;font-weight:800;letter-spacing:1.5px;border:1px solid ${accentBorder};">
      ${statusIcon.replace('currentColor', accent)}&nbsp; ${statusLabel}
    </span>
  </div>

  <!-- GREETING -->
  <div style="padding:22px 28px 0;">
    <h2 style="color:#fff;font-size:19px;font-weight:700;margin:0 0 8px;">Hello ${escapeHtml(customerName)},</h2>
    <p style="color:#8888a0;font-size:14px;line-height:1.65;margin:0;">
      ${isPaymentConfirmed
        ? '🎉 Your M-PESA payment is confirmed! Your rider is being dispatched and will reach you within 45 minutes.'
        : '📋 Thanks for your order! Complete your M-PESA payment on your phone to confirm dispatch.'}
    </p>
  </div>

  <!-- META CARDS -->
  <div style="padding:18px 28px 0;">
    <table style="width:100%;border-collapse:separate;border-spacing:8px 0;">
      <tr>
        <td style="background:#16161f;border:1px solid #1e1e2c;border-radius:12px;padding:12px 14px;width:33%;">
          <div style="color:#444;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;margin-bottom:5px;">Order No.</div>
          <div style="color:#f0a500;font-size:13px;font-weight:800;font-family:monospace;">${escapeHtml(orderId)}</div>
         </td>
        <td style="background:#16161f;border:1px solid #1e1e2c;border-radius:12px;padding:12px 14px;width:33%;">
          <div style="color:#444;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;margin-bottom:5px;">Date</div>
          <div style="color:#ccc;font-size:12px;font-weight:700;">${escapeHtml(timestamp)}</div>
         </td>
        <td style="background:#16161f;border:1px solid #1e1e2c;border-radius:12px;padding:12px 14px;width:33%;">
          <div style="color:#444;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;font-weight:700;margin-bottom:5px;">Payment</div>
          <div style="color:#4cd137;font-size:12px;font-weight:800;">${escapeHtml(paymentLabel)}</div>
         </td>
      </tr>
    </table>
  </div>

  <!-- ORDER SUMMARY -->
  <div style="margin:22px 28px 0;">
    <div style="background:#16161f;border:1px solid #1e1e2c;border-radius:18px;overflow:hidden;">
      <div style="background:#1a1a26;padding:13px 20px;border-bottom:1px solid #1e1e2c;">
        <span style="color:#f0a500;font-weight:800;font-size:13px;letter-spacing:0.5px;">${icons.bag.replace('currentColor','#f0a500')}&nbsp; ORDER ITEMS</span>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <tbody>${itemsHtml}</tbody>
      </table>
      <div style="padding:10px 20px 4px;border-top:1px solid #1e1e2c;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;color:#777;font-size:14px;">Subtotal</td><td style="padding:8px 0;text-align:right;color:#ccc;font-size:14px;font-weight:700;">KES ${subtotal.toLocaleString()}</td></tr>
          <tr><td style="padding:8px 0 12px;color:#777;font-size:14px;border-bottom:1px solid #1c1c28;">Delivery Fee</td><td style="padding:8px 0 12px;text-align:right;border-bottom:1px solid #1c1c28;font-size:14px;">${deliveryText}</td></tr>
        </table>
      </div>
      <div style="margin:12px 14px 14px;background:${isPaymentConfirmed ? '#0a1a0a' : '#1a0808'};border-radius:14px;padding:16px 18px;border:1px solid ${accentBorder};">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="color:#fff;font-size:17px;font-weight:800;">TOTAL</td><td style="text-align:right;color:#e03131;font-size:22px;font-weight:900;">KES ${total.toLocaleString()}</td></tr>
        </table>
      </div>
    </div>
  </div>

  <!-- DELIVERY ADDRESS -->
  <div style="margin:16px 28px 0;">
    <div style="background:#16161f;border:1px solid #1e1e2c;border-radius:18px;padding:18px 20px;">
      <div style="margin-bottom:10px;">
        <span style="color:${accent};font-weight:800;font-size:11px;letter-spacing:1px;text-transform:uppercase;">${icons.pin.replace('currentColor', accent)}&nbsp; DELIVERY ADDRESS</span>
      </div>
      <div style="color:#ddd;font-size:14px;line-height:1.6;margin-bottom:10px;">${escapeHtml(address)}</div>
      <div style="color:#666;font-size:13px;">${icons.phone.replace('currentColor','#555')}&nbsp; ${escapeHtml(phone || 'Provided at checkout')}</div>
    </div>
  </div>

  <!-- STATUS BANNER -->
  <div style="margin:16px 28px 0;">
    <div style="background:${accentDim};border:1px solid ${accentBorder};border-radius:18px;padding:20px;text-align:center;">
      <div style="margin-bottom:8px;">${isPaymentConfirmed ? icons.truck.replace('currentColor', accent) : icons.clock.replace('currentColor', accent)}</div>
      <div style="color:${accent};font-weight:800;font-size:15px;margin-bottom:6px;">
        ${isPaymentConfirmed ? 'Rider Dispatched — On the way!' : 'Awaiting M-PESA Confirmation'}
      </div>
      <div style="color:#666;font-size:13px;line-height:1.5;">
        ${isPaymentConfirmed
          ? `Rider will call ${escapeHtml(phone || 'your number')} when nearby. Share live location on WhatsApp for fastest delivery.`
          : 'Check your phone for the M-PESA STK push prompt and complete payment.'}
      </div>
    </div>
  </div>

  <!-- CTA BUTTON -->
  <div style="padding:20px 28px 24px;text-align:center;">
    <a href="https://teemoreg.github.io/liquorbelle/track-orders.html?email=${encodeURIComponent(customerEmail || '')}"
       style="display:inline-block;background:linear-gradient(135deg,#e03131,#b71c1c);color:#fff;text-decoration:none;padding:14px 36px;border-radius:50px;font-weight:800;font-size:15px;box-shadow:0 8px 24px rgba(224,49,49,0.3);letter-spacing:0.3px;">
      ${icons.search.replace('currentColor','white')}&nbsp; Track Your Order
    </a>
  </div>

  <!-- FOOTER -->
  <div style="background:#0d0d14;border-top:1px solid #18181f;padding:18px 28px;text-align:center;">
    <div style="margin-bottom:10px;color:#3a3a50;font-size:11px;">
      ${icons.phone.replace('currentColor','#3a3a50')}&nbsp; +254 748 894 443
      &nbsp;&nbsp;·&nbsp;&nbsp;
      WhatsApp 24/7
    </div>
    <div style="color:#2a2a3a;font-size:10px;margin-bottom:6px;">
      ${icons.warn.replace('currentColor','#2a2a3a')}&nbsp; You must be 18+ to purchase alcohol. Drink responsibly.
    </div>
    <div style="color:#1e1e28;font-size:9px;">LiquorBelle — Dagoretti Road, Opposite Quickmart</div>
  </div>

</div>
</div>
</body>
</html>`;
}

// ==================== OTP EMAIL TEMPLATE ====================
function generateOtpEmailHtml(otp) {
  const digits = String(otp).split('');
  const boxes = digits.map(d => `<td style="padding:0 4px;"><div style="width:42px;height:54px;background:#16161f;border:1px solid #2a2a3c;border-radius:12px;text-align:center;line-height:54px;font-size:24px;font-weight:900;color:#f0a500;font-family:monospace;">${d}</div></td>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Verification Code - LiquorBelle</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:20px;">
<div style="background:linear-gradient(160deg,#111118 0%,#0f0f17 100%);border-radius:24px;overflow:hidden;border:1px solid #1e1e2c;box-shadow:0 20px 60px rgba(0,0,0,0.6);">

  <!-- TOP ACCENT BAR -->
  <div style="height:3px;background:linear-gradient(90deg,#e03131,#f0a500,#e03131);"></div>

  <!-- HEADER -->
  <div style="background:linear-gradient(135deg,#1a0808 0%,#0f0f18 100%);text-align:center;padding:30px 24px 22px;border-bottom:1px solid #1a1a28;">
    <img src="https://res.cloudinary.com/dvqjgbdhp/image/upload/v1780905905/WhatsApp_Image_2026-06-04_at_3.41.50_PM_saprsh.jpg" alt="LiquorBelle" style="width:56px;height:56px;border-radius:14px;margin-bottom:12px;box-shadow:0 6px 20px rgba(224,49,49,0.25);">
    <div style="font-size:23px;font-weight:900;color:#fff;letter-spacing:-0.5px;">Liquor<span style="color:#e03131;">Belle</span></div>
    <div style="margin-top:6px;color:#555;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">Dagoretti's Finest &nbsp;·&nbsp; 24/7 Delivery</div>
  </div>

  <!-- LOCK ICON + HEADING -->
  <div style="padding:28px 24px 0;text-align:center;">
    <div style="display:inline-block;background:rgba(224,49,49,0.08);border:1px solid rgba(224,49,49,0.2);border-radius:16px;padding:14px;margin-bottom:14px;">
      ${icons.lock.replace('currentColor','#e03131')}
    </div>
    <h2 style="color:#fff;font-size:19px;font-weight:800;margin:0 0 8px;">Verify Your Identity</h2>
    <p style="color:#666;font-size:13px;line-height:1.6;margin:0;">Enter this code in the app. It expires in <strong style="color:#f0a500;">10 minutes</strong>.</p>
  </div>

  <!-- OTP DIGIT BOXES -->
  <div style="margin:24px 24px 0;background:#0f0f18;border:1px solid #1e1e2c;border-radius:18px;padding:26px 20px;text-align:center;">
    <div style="color:#444;font-size:10px;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:16px;">Your One-Time Code</div>
    <table style="margin:0 auto;border-collapse:separate;border-spacing:0;">
      <tr>${boxes}</tr>
    </table>
    <div style="margin-top:16px;color:#555;font-size:12px;">
      ${icons.clock.replace('currentColor','#555')}&nbsp; Expires in <strong style="color:#f0a500;">10 minutes</strong>
    </div>
  </div>

  <!-- WARNING -->
  <div style="margin:14px 24px 0;">
    <div style="background:rgba(240,165,0,0.05);border:1px solid rgba(240,165,0,0.12);border-radius:12px;padding:13px 16px;">
      <span style="color:#f0a500;font-size:11px;">${icons.warn.replace('currentColor','#f0a500')}</span>
      <span style="color:#555;font-size:12px;"> Never share this code. LiquorBelle staff will never ask for it.</span>
    </div>
  </div>

  <!-- FOOTER -->
  <div style="background:#0d0d14;border-top:1px solid #18181f;margin-top:24px;padding:16px 24px;text-align:center;">
    <div style="color:#1e1e28;font-size:10px;">LiquorBelle &nbsp;·&nbsp; Dagoretti's Finest &nbsp;·&nbsp; 18+ only</div>
  </div>

</div>
</div>
</body>
</html>`;
}

// ==================== SEND ORDER PAID EMAIL ====================
const BREVO_API_KEY = process.env.BREVO_API_KEY;

async function sendOrderPaidEmail(orderId, email, customerName, orderNumber, total, address, items, subtotal, delivery, phone, timestamp) {
  if (!BREVO_API_KEY) return;
  const html = generateOrderEmailHtml({
    orderId: orderNumber,
    customerName,
    items: items || [],
    subtotal: subtotal || 0,
    delivery: delivery || 0,
    total,
    address,
    timestamp: timestamp || new Date().toLocaleString('en-KE', { hour12: true, hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }),
    paymentMethod: 'mpesa',
    phone: phone || '',
    customerEmail: email
  }, true);
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'LiquorBelle', email: 'timblax0@gmail.com' },
      to: [{ email }],
      subject: `✅ Payment Confirmed - Order ${orderNumber} - LiquorBelle`,
      htmlContent: html
    }, { headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' } });
    console.log(`📧 Payment confirmation email sent to ${email}`);
  } catch (err) {
    console.error('❌ Payment email error:', err.response?.data || err.message);
  }
}

// ==================== ADMIN LOGIN (JWT with role) ====================
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = jwt.sign({ role: 'admin', type: 'admin' }, JWT_SECRET, { expiresIn: '1d' });
    return res.json({ success: true, token, role: 'admin' });
  }
  if (password === CASHIER_PASSWORD) {
    const token = jwt.sign({ role: 'cashier', type: 'cashier' }, JWT_SECRET, { expiresIn: '1d' });
    return res.json({ success: true, token, role: 'cashier' });
  }
  res.status(401).json({ success: false, message: 'Invalid password' });
});

// ==================== USER AUTHENTICATION ENDPOINTS ====================

// Register new user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    if (!name || !phone || !email || !password) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    if (!email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const existingUser = await db.collection('users').findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists with this email' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const user = {
      name,
      phone,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: 'user',
      created_at: new Date(),
      updated_at: new Date()
    };
    const result = await db.collection('users').insertOne(user);

    const token = jwt.sign(
      { id: result.insertedId, email: user.email, name: user.name, role: 'user' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );
    const { password: _, ...userWithoutPassword } = user;
    userWithoutPassword._id = result.insertedId;
    res.json({
      success: true,
      message: 'Account created successfully',
      user: userWithoutPassword,
      token
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const user = await db.collection('users').findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, name: user.name, role: 'user' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );
    const { password: _, ...userWithoutPassword } = user;
    res.json({
      success: true,
      message: 'Login successful',
      user: userWithoutPassword,
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// Verify token
app.get('/api/auth/verify', authenticateToken, async (req, res) => {
  try {
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { password: 0 } }
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Token verification failed' });
  }
});

// Delete user account
app.delete('/api/auth/delete', authenticateToken, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password required' });
    }

    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect password' });
    }

    await db.collection('users').deleteOne({ _id: user._id });
    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (err) {
    console.error('Account deletion error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete account' });
  }
});

// Get user profile
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { password: 0 } }
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ success: false, message: 'Failed to get profile' });
  }
});

// Update user profile
app.put('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const { name, phone } = req.body;
    const updateData = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    updateData.updated_at = new Date();

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.user.id) },
      { $set: updateData }
    );

    const updatedUser = await db.collection('users').findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { password: 0 } }
    );
    const token = jwt.sign(
      { id: updatedUser._id, email: updatedUser.email, name: updatedUser.name, role: 'user' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );
    res.json({ success: true, user: updatedUser, token });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
});

// Get user's own orders
app.get('/api/auth/orders', authenticateToken, async (req, res) => {
  try {
    const orders = await db.collection('orders')
      .find({ customer_email: req.user.email })
      .sort({ created_at: -1 })
      .toArray();
    res.json({ success: true, orders });
  } catch (err) {
    console.error('Get user orders error:', err);
    res.status(500).json({ success: false, message: 'Failed to get orders' });
  }
});

// ==================== SAFARICOM DARAJA CREDENTIALS ====================
const CONSUMER_KEY = process.env.CONSUMER_KEY || 'YOUR_CONSUMER_KEY';
const CONSUMER_SECRET = process.env.CONSUMER_SECRET || 'YOUR_CONSUMER_SECRET';
const PASSKEY = process.env.PASSKEY;
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

      // Store pending order in MongoDB (persistent)
      await db.collection('pending_orders').insertOne({
        orderId,
        customerName,
        phone: formattedPhone,
        address,
        items,
        subtotal,
        delivery,
        total,
        created_at: new Date(),
        paid: false
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
    const pendingOrder = await db.collection('pending_orders').findOne({ orderId });
    if (pendingOrder) {
      let msg = `✅ PAYMENT CONFIRMED ✅\n\n`;
      msg += `Order ID: ${pendingOrder.orderId}\n`;
      msg += `Customer: ${pendingOrder.customerName}\n`;
      msg += `Phone: ${pendingOrder.phone}\n`;
      msg += `Address: ${pendingOrder.address}\n\n`;
      msg += `ITEMS:\n`;
      pendingOrder.items.forEach(i => { msg += `• ${i.name} x${i.qty} — KES ${(i.price * i.qty).toLocaleString()}\n`; });
      msg += `\nSubtotal: KES ${pendingOrder.subtotal.toLocaleString()}\n`;
      msg += `Delivery: ${pendingOrder.delivery === 0 ? 'FREE' : 'KES ' + pendingOrder.delivery.toLocaleString()}\n`;
      msg += `TOTAL PAID: KES ${pendingOrder.total.toLocaleString()}\n\n`;
      msg += `📍 Please share your live location now for delivery. 📍\n(📎 → Location → Share Live Location)`;
      await db.collection('pending_orders').updateOne(
        { orderId },
        { $set: { paid: true, message: msg, paid_at: new Date() } }
      );
    }
  } else {
    console.log(`❌ Payment failed: ${stkCallback.ResultDesc}`);
  }
  res.json({ ResultCode: 0 });
});

// ==================== PAYMENT STATUS ====================
app.get('/api/status/:orderId', async (req, res) => {
  const pendingOrder = await db.collection('pending_orders').findOne({ orderId: req.params.orderId });
  if (pendingOrder && pendingOrder.paid) {
    const waLink = `https://wa.me/${BUSINESS_NUMBER}?text=${encodeURIComponent(pendingOrder.message)}`;
    res.json({ status: 'paid', waLink, message: pendingOrder.message });
  } else {
    res.json({ status: 'pending' });
  }
});

// ==================== EMAIL OTP (MongoDB persistent) ====================
const otpStore = new Map(); // Backup, but mainly use MongoDB

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

    // Store OTP in MongoDB with TTL
    await db.collection('otps').updateOne(
      { email },
      { $set: { otp, created_at: new Date() } },
      { upsert: true }
    );

    const html = generateOtpEmailHtml(otp);

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

app.post('/api/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  const stored = await db.collection('otps').findOne({ email });

  if (!stored) return res.json({ success: false, message: 'No OTP found. Request a new one.' });
  if (stored.otp !== otp) return res.json({ success: false, message: 'Invalid OTP. Try again.' });

  await db.collection('otps').deleteOne({ email });
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
      subject: `📦 Order Confirmed ${orderId} - LiquorBelle`,
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

// Get all products (public)
app.get('/api/db/products', async (req, res) => {
  try {
    const products = await db.collection('products').find({}).sort({ created_at: -1 }).toArray();
    res.json({ success: true, products });
  } catch (err) {
    console.error('Products fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

// Create product (admin only)
app.post('/api/db/products', requireAdmin, async (req, res) => {
  try {
    const { name, category, badge, image, description, variants, isTrending } = req.body;

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
      isTrending: isTrending || false,
      created_at: new Date(),
      updated_at: new Date()
    };
    const result = await db.collection('products').insertOne(product);
    res.json({ success: true, product: { _id: result.insertedId, ...product } });
  } catch (err) {
    console.error('Product create error:', err);
    res.status(500).json({ success: false, message: 'Failed to create product' });
  }
});

// Update product (admin only)
app.put('/api/db/products/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, badge, image, description, variants, isTrending } = req.body;

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
      { $set: { name, category, badge, image, description, variants, isTrending: isTrending || false, updated_at: new Date() } }
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

// Delete product (admin only)
app.delete('/api/db/products/:id', requireAdmin, async (req, res) => {
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

// Get all orders (admin only)
app.get('/api/db/orders', requireAdmin, async (req, res) => {
  try {
    const orders = await db.collection('orders').find({}).sort({ created_at: -1 }).toArray();
    res.json({ success: true, orders });
  } catch (err) {
    console.error('Orders fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

// Get order by ID (admin only)
app.get('/api/db/orders/:id', requireAdmin, async (req, res) => {
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

// Create order (public - anyone can create)
app.post('/api/db/orders', async (req, res) => {
  try {
    const { orderNumber, userId, customerName, customerEmail, phone, address, notes, subtotal, delivery, total, paymentMethod, status, items } = req.body;

    // Validation
    if (!orderNumber || !customerName || !customerEmail || !phone || !address) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    if (!customerEmail.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email required' });
    }
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one item required' });
    }
    if (typeof total !== 'number' || total <= 0) {
      return res.status(400).json({ success: false, message: 'Valid total amount required' });
    }

    const order = {
      order_number: orderNumber,
      user_id: userId || null,
      customer_name: customerName,
      customer_email: customerEmail.toLowerCase(),
      phone,
      address,
      notes: notes || '',
      subtotal: subtotal || 0,
      delivery: delivery || 0,
      total,
      payment_method: paymentMethod,
      status: status || 'pending',
      items: items.map(item => ({ ...item, size: item.size || '750ml' })),
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await db.collection('orders').insertOne(order);
    res.json({ success: true, order: { _id: result.insertedId, ...order } });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
});

// Update order status (admin only)
app.put('/api/db/orders/:id/status', requireAdmin, async (req, res) => {
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
          order._id,
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

// Delete order (admin only)
app.delete('/api/db/orders/:id', requireAdmin, async (req, res) => {
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

// Dashboard stats (admin only) - OPTIMIZED with Promise.all
app.get('/api/db/stats', requireAdmin, async (req, res) => {
  try {
    const [
      totalOrders,
      totalProducts,
      revenueResult,
      pendingOrdersCount,
      paidOrdersCount,
      deliveredOrdersCount,
      totalUsers
    ] = await Promise.all([
      db.collection('orders').countDocuments(),
      db.collection('products').countDocuments(),
      db.collection('orders').aggregate([
        { $match: { status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]).toArray(),
      db.collection('orders').countDocuments({ status: 'pending' }),
      db.collection('orders').countDocuments({ status: 'paid' }),
      db.collection('orders').countDocuments({ status: 'delivered' }),
      db.collection('users').countDocuments()
    ]);

    const totalRevenue = revenueResult[0]?.total || 0;

    res.json({
      success: true,
      stats: {
        totalOrders,
        totalProducts,
        totalRevenue,
        pendingOrders: pendingOrdersCount,
        paidOrders: paidOrdersCount,
        deliveredOrders: deliveredOrdersCount,
        totalUsers
      }
    });
  } catch (err) {
    console.error('Stats fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});

// Delivery settings (admin only)
app.get('/api/admin/delivery-settings', requireAdmin, async (req, res) => {
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

app.post('/api/admin/delivery-settings', requireAdmin, async (req, res) => {
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

// Recent orders for cashier (last 24 hours) - admin only
app.get('/api/admin/recent-orders', requireAdmin, async (req, res) => {
  try {
    const last24h = new Date();
    last24h.setHours(last24h.getHours() - 24);

    const orders = await db.collection('orders')
      .find({ created_at: { $gte: last24h } })
      .sort({ created_at: -1 })
      .toArray();

    res.json({ success: true, orders });
  } catch (err) {
    console.error('Recent orders error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch recent orders' });
  }
});

// Admin verification (simple)
app.post('/api/admin/verify', async (req, res) => {
  const { password, type } = req.body;
  if (type === 'orders') {
    res.json({ success: password === CASHIER_PASSWORD });
  } else {
    res.json({ success: password === ADMIN_PASSWORD });
  }
});

// Health check (public)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: 'MongoDB',
    brevoConfigured: !!BREVO_API_KEY,
    message: 'LiquorBelle API is running with variants support and user authentication',
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
    console.log(`💳 M-PESA: ${CONSUMER_KEY && CONSUMER_KEY !== 'YOUR_CONSUMER_KEY' ? '✅ Configured' : '⚠️ Sandbox mode'}`);
    console.log(`🔒 Rate Limiting: ✅ Active`);
    console.log(`🗄️ MongoDB: ✅ Connected`);
    console.log(`👤 User Authentication: ✅ Enabled (JWT + bcrypt)`);
    console.log(`🔐 Admin Protection: ✅ JWT-based admin roles`);
    console.log(`💾 Pending Orders: ✅ Persistent (MongoDB)`);
    console.log(`📱 OTP Storage: ✅ Persistent (MongoDB with TTL)`);
  });
});
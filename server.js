require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const { connectDB, getDB, closeDB } = require('./config/database');
const { validateEnv } = require('./config/env');
const { 
  generalLimiter, 
  otpLimiter, 
  stkLimiter,
  orderCreateLimiter,
  adminLimiter,
  geocodeLimiter,
  loginLimiter
} = require('./config/rateLimits');
const { orderCache, productCache, statsCache } = require('./utils/cache');
const { loadPasswordsFromDB } = require('./utils/passwords');

// ==================== VALIDATE ENVIRONMENT ====================
validateEnv();

const app = express();
const PORT = process.env.PORT || 10000;

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
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://teemoreg.github.io',
      'http://localhost:3000',
      'http://localhost:5500',
      'http://127.0.0.1:5500',
      'http://localhost:8000',
      'http://127.0.0.1:8000'
    ];
    
    // Allow any localhost port for development
    if (origin.match(/^http:\/\/localhost:\d+$/)) {
      return callback(null, true);
    }
    if (origin.match(/^http:\/\/127\.0\.0\.1:\d+$/)) {
      return callback(null, true);
    }
    // Allow file:// protocol for local testing
    if (origin === 'null' || origin === 'file://') {
      return callback(null, true);
    }
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
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

// ==================== RATE LIMITING ====================
app.use('/api/', generalLimiter);

// OTP rate limiter (email only)
app.use('/api/send-email-otp', otpLimiter);
app.use('/api/auth/send-email-otp', otpLimiter);

// Auth rate limiters
app.use('/api/auth/register', loginLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/login-phone', loginLimiter);
app.use('/api/auth/forgot-pin', loginLimiter);
app.use('/api/auth/reset-pin', loginLimiter);

// Payment & order rate limiters
app.use('/api/stkpush', stkLimiter);
app.use('/api/orders/pod', orderCreateLimiter);
app.use('/api/payments/stkpush', stkLimiter);

// Admin rate limiters
app.use('/api/db/', adminLimiter);
app.use('/api/admin/', adminLimiter);

// Geocode rate limiter
app.use('/api/geocode/', geocodeLimiter);

// Admin/Cashier login rate limiters
app.use('/api/auth/admin/login', loginLimiter);
app.use('/api/auth/cashier/login', loginLimiter);

// ==================== EXPOSE CACHE ====================
app.set('orderCache', orderCache);
app.set('productCache', productCache);
app.set('statsCache', statsCache);

// ==================== ROUTES ====================
// Auth routes (PIN-based, email OTP)
app.use('/api/auth', require('./routes/auth'));

// Admin auth routes - ADDED THIS
app.use('/api/admin', require('./routes/admin-auth'));

// Product routes
app.use('/api/db/products', require('./routes/products'));

// Order routes
app.use('/api/db/orders', require('./routes/orders'));
app.use('/api/orders', require('./routes/orders'));

// Payment routes (M-PESA)
app.use('/api', require('./routes/payments'));
app.use('/api/payments', require('./routes/payments'));

// Admin routes
app.use('/api/admin', require('./routes/admin'));

// Customer routes (profile, favorites, orders)
app.use('/api/customers', require('./routes/customers'));

// OTP routes (email only)
app.use('/api', require('./routes/otp'));

// Geocode routes
app.use('/api/geocode', require('./routes/geocode'));

// Delivery routes
app.use('/api', require('./routes/delivery'));

// Categories routes
app.use('/api/categories', require('./routes/categories'));

// Order tracking routes
app.use('/api/orders/track', require('./routes/order-tracking'));

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
  const db = getDB();
  res.json({
    status: 'ok',
    database: db ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    cache: {
      orders: orderCache.keys().length,
      products: productCache.keys().length,
      stats: statsCache.keys().length
    },
    environment: process.env.NODE_ENV || 'development'
  });
});

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { error: err.message })
  });
});

// ==================== 404 HANDLER ====================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// ==================== START SERVER ====================
async function startServer() {
  try {
    await connectDB();
    await loadPasswordsFromDB();

    // Auto-clear stats cache daily
    setInterval(() => {
      statsCache.del('stats_daily');
      statsCache.del('stats_weekly');
      statsCache.del('stats_monthly');
      statsCache.del('legacy_stats');
      statsCache.del('category_stats');
      console.log('✅ Stats cache cleared (daily refresh)');
    }, 24 * 60 * 60 * 1000);

    // Auto-clear OTPs every hour
    setInterval(async () => {
      try {
        const db = getDB();
        if (db) {
          const result = await db.collection('otps').deleteMany({
            created_at: { $lt: new Date(Date.now() - 60 * 60 * 1000) } // 1 hour old
          });
          if (result.deletedCount > 0) {
            console.log(`✅ Cleared ${result.deletedCount} expired OTPs`);
          }
        }
      } catch (err) {
        // Silently fail
      }
    }, 60 * 60 * 1000);

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🍾 LIQUORBELLE BACKEND SERVER                     ║
║                                                       ║
║   Port: ${PORT}                                       ║
║   Database: Connected                                ║
║   Environment: ${process.env.NODE_ENV || 'development'} ║
║                                                       ║
║   Email: ${process.env.BREVO_API_KEY ? '✅ Enabled' : '❌ Disabled'}   ║
║   M-PESA: ${process.env.CONSUMER_KEY ? '✅ Enabled' : '❌ Disabled'}   ║
║   Google Sheets: ${process.env.GOOGLE_SHEETS_API_KEY ? '✅ Enabled' : '❌ Disabled'} ║
║                                                       ║
║   Auth: PIN-based with Email OTP                     ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
      `);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

// ==================== GRACEFUL SHUTDOWN ====================
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, closing server...');
  await closeDB();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, closing server...');
  await closeDB();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;
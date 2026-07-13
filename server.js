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

// ==================== RATE LIMITING ====================
app.use('/api/', generalLimiter);
app.use('/api/send-email-otp', otpLimiter);
app.use('/api/stkpush', stkLimiter);
app.use('/api/orders/pod', orderCreateLimiter);
app.use('/api/db/', adminLimiter);
app.use('/api/admin/', adminLimiter);
app.use('/api/geocode/', geocodeLimiter);
app.use('/api/auth/admin/login', loginLimiter);
app.use('/api/auth/cashier/login', loginLimiter);
app.use('/api/auth/customers/login', loginLimiter);

// ==================== EXPOSE CACHE ====================
app.set('orderCache', orderCache);
app.set('productCache', productCache);
app.set('statsCache', statsCache);

// ==================== ROUTES ====================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/db/products', require('./routes/products'));
app.use('/api/db/orders', require('./routes/orders'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api', require('./routes/payments'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api', require('./routes/otp'));
app.use('/api/geocode', require('./routes/geocode'));
app.use('/api', require('./routes/delivery'));
app.use('/api/categories', require('./routes/categories'));
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
      console.log('Stats cache cleared (daily refresh)');
    }, 24 * 60 * 60 * 1000);

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   LIQUORBELLE BACKEND SERVER                         ║
║                                                       ║
║   Port: ${PORT}                                       ║
║   Database: Connected                                ║
║   Environment: ${process.env.NODE_ENV || 'development'} ║
║                                                       ║
║   Email: ${process.env.BREVO_API_KEY ? 'Enabled' : 'Disabled'}   ║
║   M-PESA: ${process.env.CONSUMER_KEY ? 'Enabled' : 'Disabled'}   ║
║   Google Sheets: ${process.env.GOOGLE_SHEETS_API_KEY ? 'Enabled' : 'Disabled'} ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
      `);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

// ==================== GRACEFUL SHUTDOWN ====================
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await closeDB();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing server...');
  await closeDB();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;
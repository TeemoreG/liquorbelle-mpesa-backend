require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const passport = require('passport');
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

// 1. MIDDLEWARE 

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: [
        "'self'", 
        "https://liquorbelle-mpesa-backend.onrender.com", 
        "https://api.brevo.com", 
        "https://sandbox.safaricom.co.ke",
        "https://api.liquorbelle.co.ke"
      ],
      imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
      scriptSrc: [
        "'self'", 
        "'unsafe-inline'", 
        "https://unpkg.com", 
        "https://fonts.googleapis.com",
        "https://static.cloudflareinsights.com"
      ],
      scriptSrcElem: [
        "'self'", 
        "'unsafe-inline'", 
        "https://unpkg.com", 
        "https://fonts.googleapis.com",
        "https://static.cloudflareinsights.com"
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://unpkg.com"],
    },
  },
}));

// Body parser - MUST BE BEFORE ROUTES
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(compression());

// CORS
const allowedOrigins = [
  'https://teemoreg.github.io',
  'https://liquorbelle-mpesa-backend.onrender.com',
  'https://liquorbelle.co.ke',
  'https://www.liquorbelle.co.ke',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:5000',
  'http://127.0.0.1:5000'
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.match(/^http:\/\/localhost:\d+$/)) {
      return callback(null, true);
    }
    if (origin.match(/^http:\/\/127\.0\.0\.1:\d+$/)) {
      return callback(null, true);
    }
    if (origin === 'null' || origin === 'file://') {
      return callback(null, true);
    }
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    console.warn(`⚠️ CORS blocked origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
}));

// Session & Passport
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// Logging
app.use(morgan('combined', {
  skip: (req) => req.path === '/api/health' || req.path === '/'
}));

app.set('trust proxy', 1);

// ============================================================
// 2. RATE LIMITING
// ============================================================
app.use('/api/', generalLimiter);

app.use('/api/send-email-otp', otpLimiter);
app.use('/api/auth/send-email-otp', otpLimiter);

app.use('/api/auth/register', loginLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/login-phone', loginLimiter);
app.use('/api/auth/forgot-pin', loginLimiter);
app.use('/api/auth/reset-pin', loginLimiter);

app.use('/api/stkpush', stkLimiter);
app.use('/api/orders/pod', orderCreateLimiter);
app.use('/api/payments/stkpush', stkLimiter);

app.use('/api/db/', adminLimiter);
app.use('/api/admin/', adminLimiter);

app.use('/api/geocode/', geocodeLimiter);

app.use('/api/auth/admin/login', loginLimiter);
app.use('/api/auth/cashier/login', loginLimiter);

// ============================================================
// 3. REQUEST LOGGING (Debug)
// ============================================================
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'development' && req.path.startsWith('/api/')) {
    console.log(`📥 ${req.method} ${req.path} - Origin: ${req.headers.origin || 'unknown'}`);
  }
  next();
});

// ============================================================
// 4. EXPOSE CACHE
// ============================================================
app.set('orderCache', orderCache);
app.set('productCache', productCache);
app.set('statsCache', statsCache);

// ============================================================
// 5. ROUTES - AFTER ALL MIDDLEWARE
// ============================================================

// Auth routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/auth', require('./routes/google-auth'));

// Admin auth routes
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

// ✅ Delivery routes (Public)
app.use('/api', require('./routes/delivery'));

// ✅ Delivery routes (Admin - Added to handle admin settings and zones)
app.use('/api/admin', require('./routes/delivery'));

// Categories routes
app.use('/api/categories', require('./routes/categories'));

// Order tracking routes
app.use('/api/orders/track', require('./routes/order-tracking'));

// ❌ DELETED: Delivery zones routes (File removed, merged into delivery.js)

// ============================================================
// 6. HEALTH CHECK & ROOT
// ============================================================
app.get('/api/health', (req, res) => {
  const db = getDB();
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    database: db ? 'connected' : 'disconnected',
    cache: {
      orders: orderCache.keys().length,
      products: productCache.keys().length,
      stats: statsCache.keys().length
    },
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    cors: {
      allowedOrigins: allowedOrigins,
      origin: req.headers.origin || 'none'
    }
  };
  res.json(health);
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.head('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'LiquorBelle API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      products: '/api/db/products',
      orders: '/api/db/orders',
      auth: '/api/auth',
      admin: '/api/admin'
    },
    cors: {
      allowedOrigins: allowedOrigins
    }
  });
});

// ============================================================
// 7. ERROR HANDLING - MUST BE AFTER ROUTES
// ============================================================

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.body,
    query: req.query,
    params: req.params
  });
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: err.errors,
      timestamp: new Date().toISOString()
    });
  }
  
  if (err.name === 'MongoError' || err.name === 'MongoServerError') {
    return res.status(500).json({
      success: false,
      message: 'Database Error',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
  
  const statusCode = err.status || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      path: req.path,
      method: req.method
    }),
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// 8. START SERVER
// ============================================================
async function startServer() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ MongoDB connected successfully');
    
    await loadPasswordsFromDB();
    console.log('✅ Password hashes loaded');

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
            created_at: { $lt: new Date(Date.now() - 60 * 60 * 1000) }
          });
          if (result.deletedCount > 0) {
            console.log(`✅ Cleared ${result.deletedCount} expired OTPs`);
          }
        }
      } catch (err) {
        // Silently fail
      }
    }, 60 * 60 * 1000);

    // Auto-clear expired sessions every 12 hours
    setInterval(async () => {
      try {
        const db = getDB();
        if (db) {
          const result = await db.collection('sessions').deleteMany({
            expiresAt: { $lt: new Date() }
          });
          if (result.deletedCount > 0) {
            console.log(`✅ Cleared ${result.deletedCount} expired sessions`);
          }
        }
      } catch (err) {
        // Silently fail
      }
    }, 12 * 60 * 60 * 1000);

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   LIQUORBELLE BACKEND SERVER                            ║
║                                                              ║
║   Port: ${PORT}                                              ║
║   Database: ✅ Connected                                    ║
║   Environment: ${process.env.NODE_ENV || 'development'}      ║
║   Uptime: ${process.uptime()}s                              ║
║                                                              ║
║   Email: ${process.env.BREVO_API_KEY ? '✅ Enabled' : '❌ Disabled'}  ║
║   M-PESA: ${process.env.CONSUMER_KEY ? '✅ Enabled' : '❌ Disabled'}  ║
║   Google Sheets: ${process.env.GOOGLE_SHEETS_API_KEY ? '✅ Enabled' : '❌ Disabled'} ║
║                                                              ║
║   Auth: PIN-based with Email OTP                            ║
║   CORS: ${allowedOrigins.length} origins allowed              ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
      `);
      
      console.log(`Server is ready at http://localhost:${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
      console.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
    });

    server.timeout = 120000;
    server.keepAliveTimeout = 120000;
    server.headersTimeout = 120000;

    return server;

  } catch (err) {
    console.error('Failed to start server:', err.message);
    console.error('Stack:', err.stack);
    throw err;
  }
}

// ============================================================
// 9. RETRY MECHANISM
// ============================================================
async function startServerWithRetry() {
  let retries = 0;
  const maxRetries = 5;
  
  while (retries < maxRetries) {
    try {
      await startServer();
      return;
    } catch (err) {
      retries++;
      console.log(`Start attempt ${retries} failed. Retrying in ${retries * 5} seconds...`);
      await new Promise(resolve => setTimeout(resolve, retries * 5000));
    }
  }
  
  console.error('Failed to start server after multiple attempts');
  process.exit(1);
}

// ============================================================
// 10. GRACEFUL SHUTDOWN
// ============================================================
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`🛑 ${signal} received, starting graceful shutdown...`);
  
  try {
    await closeDB();
    console.log('Database connection closed');
    console.log('Shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  console.error('Stack:', err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
});

// ============================================================
// 11. START
// ============================================================
startServerWithRetry();

module.exports = app;
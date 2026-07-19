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

// ==================== ADD THESE TWO LINES ====================
const session = require('express-session');
const passport = require('passport');

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

// ==================== CORS - FIXED ====================
const allowedOrigins = [
  'https://teemoreg.github.io',
  'https://liquorbelle-mpesa-backend.onrender.com',
  'https://liquorbelle.com',
  'https://www.liquorbelle.com',
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

// ==================== ADD SESSION & PASSPORT HERE ====================
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

// ... rest of your code (logging, rate limiting, etc.)

// ==================== ROUTES ====================
// Auth routes (PIN-based, email OTP)
app.use('/api/auth', require('./routes/auth'));

// ==================== ADD GOOGLE AUTH ROUTE HERE ====================
app.use('/api/auth', require('./routes/google-auth'));

// ... rest of your routes

// ==================== START SERVER ====================
// ... your existing server start code

// ==================== LOGGING ====================
app.use(morgan('combined', {
  skip: (req) => req.path === '/api/health' || req.path === '/'
}));

app.set('trust proxy', 1);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
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

// ==================== REQUEST LOGGING (Debug) ====================
app.use((req, res, next) => {
  // Log all API requests in development
  if (process.env.NODE_ENV === 'development' && req.path.startsWith('/api/')) {
    console.log(`📥 ${req.method} ${req.path} - Origin: ${req.headers.origin || 'unknown'}`);
  }
  next();
});

// ==================== EXPOSE CACHE ====================
app.set('orderCache', orderCache);
app.set('productCache', productCache);
app.set('statsCache', statsCache);

// ==================== ROUTES ====================
// Auth routes (PIN-based, email OTP)
app.use('/api/auth', require('./routes/auth'));

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

// Delivery routes
app.use('/api', require('./routes/delivery'));

// Categories routes
app.use('/api/categories', require('./routes/categories'));

// Order tracking routes
app.use('/api/orders/track', require('./routes/order-tracking'));

// Delivery zones routes
app.use('/api/delivery-zones', require('./routes/delivery-zones'));

// ==================== HEALTH CHECK ====================
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

// ==================== SIMPLE HEALTH CHECK FOR RENDER ====================
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.head('/health', (req, res) => {
  res.status(200).send('OK');
});

app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

// ==================== ROOT ROUTE ====================
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: '🍾 LiquorBelle API is running',
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

// ==================== 404 HANDLER ====================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// ==================== GLOBAL ERROR HANDLER ====================
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
  
  // Handle specific error types
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

// ==================== START SERVER ====================
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
║   🍾 LIQUORBELLE BACKEND SERVER                            ║
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
      
      console.log(`📡 Server is ready at http://localhost:${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🌐 CORS allowed origins: ${allowedOrigins.join(', ')}`);
    });

    // ==================== SERVER TIMEOUT SETTINGS ====================
    server.timeout = 120000; // 2 minutes
    server.keepAliveTimeout = 120000;
    server.headersTimeout = 120000;

    return server;

  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    console.error('Stack:', err.stack);
    // Don't exit - let the retry mechanism handle it
    throw err;
  }
}

// ==================== KEEP-ALIVE MECHANISM ====================
// Prevents Render from shutting down due to inactivity
setInterval(() => {
  console.log('🔄 Keep-alive ping at', new Date().toISOString());
}, 60000); // Every 60 seconds

// ==================== RETRY MECHANISM FOR STARTUP ====================
// If server fails to start, retry instead of exiting
async function startServerWithRetry() {
  let retries = 0;
  const maxRetries = 5;
  
  while (retries < maxRetries) {
    try {
      await startServer();
      return; // Success - exit the loop
    } catch (err) {
      retries++;
      console.log(`❌ Start attempt ${retries} failed. Retrying in ${retries * 5} seconds...`);
      await new Promise(resolve => setTimeout(resolve, retries * 5000));
    }
  }
  
  console.error('❌ Failed to start server after multiple attempts');
  process.exit(1);
}

// ==================== GRACEFUL SHUTDOWN ====================
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`🛑 ${signal} received, starting graceful shutdown...`);
  
  try {
    // Close database connections
    await closeDB();
    console.log('✅ Database connection closed');
    
    // Exit with success code
    console.log('👋 Shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during shutdown:', err);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ==================== UNCAUGHT EXCEPTION HANDLING ====================
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err.message);
  console.error('Stack:', err.stack);
  
  // Log to file if possible
  try {
    const fs = require('fs');
    const log = `${new Date().toISOString()} - ${err.message}\n${err.stack}\n\n`;
    fs.appendFileSync('./error.log', log);
  } catch (e) {
    // Ignore
  }
  
  // Don't exit - keep running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  
  // Log to file if possible
  try {
    const fs = require('fs');
    const log = `${new Date().toISOString()} - Unhandled Rejection: ${reason}\n${promise}\n\n`;
    fs.appendFileSync('./error.log', log);
  } catch (e) {
    // Ignore
  }
  
  // Don't exit - keep running
});

// ==================== START THE SERVER WITH RETRY ====================
startServerWithRetry();

module.exports = app;
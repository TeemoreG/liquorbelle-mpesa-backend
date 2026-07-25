const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library'); // npm install google-auth-library
const { getDB } = require('../config/database');
const { otpLimiter, loginLimiter, forgotPinLimiter } = require('../config/rateLimits');
const { sendOTPEmail } = require('../utils/email');
const { generateToken } = require('../config/passport');
const { generateOTP, isOTPExpired } = require('../utils/otp');

const router = express.Router();

/* ============================================================
   CONFIG / CONSTANTS
   ============================================================ */
const BCRYPT_ROUNDS = 10;
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const OTP_RESEND_COOLDOWN_MINUTES = 2;
const MAX_OTP_ATTEMPTS = 5;

// Two distinct OTP "purposes" share the same collection — always filter by
// BOTH email AND purpose so registration OTPs and reset-PIN OTPs can never
// collide or be swapped for one another.
const OTP_PURPOSE = {
  REGISTER: 'register',
  RESET_PIN: 'reset_pin'
};

// Set GOOGLE_CLIENT_ID in your environment. Required to verify Google ID tokens.
const googleClient = process.env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;

/* ============================================================
   HELPERS — Phone
   ============================================================ */
function isValidPhone(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/\D/g, '');

  if (cleaned.length === 10 && (cleaned.startsWith('07') || cleaned.startsWith('01'))) return true;
  if (cleaned.length === 9 && (cleaned.startsWith('7') || cleaned.startsWith('1'))) return true;
  if (cleaned.length === 12 && cleaned.startsWith('254')) return true;

  return false;
}

function formatPhone(phone) {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');

  if (cleaned.length === 12 && cleaned.startsWith('254')) return cleaned;
  if (cleaned.length === 10 && (cleaned.startsWith('07') || cleaned.startsWith('01'))) {
    return '254' + cleaned.slice(1);
  }
  if (cleaned.length === 9 && (cleaned.startsWith('7') || cleaned.startsWith('1'))) {
    return '254' + cleaned;
  }
  return cleaned;
}

function formatPhoneForDisplay(phone) {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 12 && cleaned.startsWith('254')) return '0' + cleaned.slice(3);
  return phone;
}

/* ============================================================
   HELPERS — Email
   ============================================================ */
function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

/* ============================================================
   HELPERS — OTP lifecycle (shared by register + forgot-pin flows)
   ============================================================ */

// Returns { allowed: boolean, message?: string } — enforces the resend cooldown.
async function checkOtpCooldown(db, email, purpose) {
  const existing = await db.collection('otps').findOne({ email, purpose });
  if (!existing) return { allowed: true };

  const isExpired = new Date() > new Date(existing.expires_at);
  const ageMinutes = (Date.now() - new Date(existing.created_at).getTime()) / 1000 / 60;

  if (!isExpired && ageMinutes < OTP_RESEND_COOLDOWN_MINUTES) {
    return {
      allowed: false,
      message: `Please wait ${OTP_RESEND_COOLDOWN_MINUTES} minutes before requesting another OTP`
    };
  }
  return { allowed: true };
}

async function issueOTP(db, email, purpose) {
  const otp = generateOTP(OTP_LENGTH);
  await db.collection('otps').updateOne(
    { email, purpose },
    {
      $set: {
        otp,
        purpose,
        created_at: new Date(),
        expires_at: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
        attempts: 0
      }
    },
    { upsert: true }
  );
  return otp;
}

// Verifies and consumes (deletes) an OTP. Returns { ok, status, message }.
async function verifyAndConsumeOTP(db, email, purpose, submittedOtp) {
  const stored = await db.collection('otps').findOne({ email, purpose });

  if (!stored) {
    return { ok: false, status: 401, message: 'No OTP found. Please request a new one.' };
  }

  if (isOTPExpired(stored.created_at, OTP_EXPIRY_MINUTES)) {
    await db.collection('otps').deleteOne({ email, purpose });
    return { ok: false, status: 401, message: 'OTP expired. Please request a new one.' };
  }

  if (stored.otp !== submittedOtp) {
    const attempts = (stored.attempts || 0) + 1;
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await db.collection('otps').deleteOne({ email, purpose });
      return { ok: false, status: 401, message: 'Too many failed attempts. Please request a new OTP.' };
    }
    await db.collection('otps').updateOne({ email, purpose }, { $set: { attempts } });
    return {
      ok: false,
      status: 401,
      message: `Invalid OTP. ${MAX_OTP_ATTEMPTS - attempts} attempts remaining.`
    };
  }

  await db.collection('otps').deleteOne({ email, purpose });
  return { ok: true };
}

/* ============================================================
   HELPERS — Responses
   ============================================================ */
function dbUnavailable(res) {
  return res.status(503).json({ success: false, message: 'Database connecting...' });
}

function validationFailed(res, errors) {
  return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
}

function publicCustomer(customer) {
  return {
    id: customer._id,
    email: customer.email,
    name: customer.name,
    phone: customer.phone,
    phoneDisplay: formatPhoneForDisplay(customer.phone),
    authMethod: customer.authMethod || 'email',
    createdAt: customer.createdAt,
    lastLoginAt: customer.lastLoginAt
  };
}

/* ============================================================
   REGISTRATION FLOW (Email OTP -> PIN account)
   ============================================================ */

// ---- Step 1: request an OTP for a NEW account ----
router.post('/send-email-otp', otpLimiter, [
  body('email').isEmail().withMessage('Valid email required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFailed(res, errors);

  const email = normalizeEmail(req.body.email);
  const db = getDB();
  if (!db) return dbUnavailable(res);

  try {
    const cooldown = await checkOtpCooldown(db, email, OTP_PURPOSE.REGISTER);
    if (!cooldown.allowed) {
      return res.status(429).json({ success: false, message: cooldown.message });
    }

    const otp = await issueOTP(db, email, OTP_PURPOSE.REGISTER);
    const sent = await sendOTPEmail(email, otp);

    if (!sent) {
      await db.collection('otps').deleteOne({ email, purpose: OTP_PURPOSE.REGISTER });
      return res.status(500).json({ success: false, message: 'Failed to send OTP email' });
    }

    res.json({ success: true, message: 'OTP sent successfully to your email' });
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

// ---- Step 2: verify OTP + create account with PIN ----
router.post('/register', [
  body('email').isEmail().withMessage('Valid email required'),
  body('name').notEmpty().withMessage('Name required').isLength({ min: 2, max: 100 }),
  body('phone').notEmpty().withMessage('Phone number required')
    .custom((value) => isValidPhone(value)).withMessage('Invalid phone number format (e.g., 0712345678)'),
  body('pin').notEmpty().withMessage('PIN required')
    .isLength({ min: 4, max: 4 }).withMessage('PIN must be exactly 4 digits')
    .isNumeric().withMessage('PIN must be numeric'),
  body('otp').notEmpty().withMessage('OTP required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFailed(res, errors);

  const email = normalizeEmail(req.body.email);
  const { name, phone, pin, otp } = req.body;
  const formattedPhone = formatPhone(phone);

  const db = getDB();
  if (!db) return dbUnavailable(res);

  try {
    const otpResult = await verifyAndConsumeOTP(db, email, OTP_PURPOSE.REGISTER, otp);
    if (!otpResult.ok) return res.status(otpResult.status).json({ success: false, message: otpResult.message });

    const existingUser = await db.collection('customers').findOne({
      $or: [{ email }, { phone: formattedPhone }]
    });

    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Email or phone already registered. Please login.' });
    }

    const hashedPin = await bcrypt.hash(pin, BCRYPT_ROUNDS);

    const customer = {
      email,
      name: name.trim(),
      phone: formattedPhone,
      pin: hashedPin,
      authMethod: 'email',
      googleCompleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
      orderHistory: [],
      favorites: []
    };

    const result = await db.collection('customers').insertOne(customer);
    const token = generateToken(result.insertedId.toString(), 'customer');

    console.log(`✅ New customer registered: ${email} | ${formattedPhone}`);

    res.json({
      success: true,
      message: 'Account created successfully',
      token,
      customer: publicCustomer({ ...customer, _id: result.insertedId })
    });
  } catch (err) {
    console.error('❌ Register error:', err);
    res.status(500).json({ success: false, message: 'Failed to create account' });
  }
});

/* ============================================================
   LOOKUPS — Check existence before signup
   ============================================================ */

router.post('/check-email', [
  body('email').isEmail().withMessage('Valid email required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFailed(res, errors);

  const email = normalizeEmail(req.body.email);
  const db = getDB();
  if (!db) return dbUnavailable(res);

  try {
    const existingUser = await db.collection('customers').findOne({ email }, { projection: { _id: 1 } });
    res.json({ success: true, exists: !!existingUser });
  } catch (err) {
    console.error('❌ Check email error:', err);
    res.status(500).json({ success: false, message: 'Failed to check email' });
  }
});

router.post('/check-user', [
  body('name').optional().isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
  body('email').optional().isEmail().withMessage('Valid email required'),
  body('phone').optional().custom((value) => isValidPhone(value)).withMessage('Invalid phone number')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFailed(res, errors);

  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ success: false, message: 'Request body is empty' });
  }

  const { name, phone } = req.body;
  const email = req.body.email ? normalizeEmail(req.body.email) : undefined;
  const formattedPhone = phone ? formatPhone(phone) : undefined;

  const db = getDB();
  if (!db) return dbUnavailable(res);

  try {
    const query = [];
    if (email) query.push({ email });
    if (formattedPhone) query.push({ phone: formattedPhone });
    if (name) query.push({ name: name.trim() });

    if (query.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one of name, email, or phone is required' });
    }

    const existingUser = await db.collection('customers').findOne(
      { $or: query },
      { projection: { email: 1, phone: 1, name: 1 } }
    );

    if (existingUser) {
      const fields = [];
      if (email && existingUser.email === email) fields.push('email');
      if (formattedPhone && existingUser.phone === formattedPhone) fields.push('phone');
      if (name && existingUser.name === name.trim()) fields.push('name');

      return res.json({
        success: true,
        exists: true,
        field: fields.length === 1 ? fields[0] : 'multiple',
        fields,
        message: `User already exists with ${fields.join(', ')}`
      });
    }

    res.json({ success: true, exists: false, message: 'User does not exist' });
  } catch (err) {
    console.error('❌ Check user error:', err);
    res.status(500).json({ success: false, message: 'Failed to check user' });
  }
});

/* ============================================================
   LOGIN FLOW (existing account -> email/phone + PIN)
   These are LOGIN endpoints only — they never create an account.
   Use /register or /complete-google-registration to sign up.
   ============================================================ */

router.post('/login', loginLimiter, [
  body('email').isEmail().withMessage('Valid email required'),
  body('pin').notEmpty().withMessage('PIN required')
    .isLength({ min: 4, max: 4 }).withMessage('PIN must be exactly 4 digits')
    .isNumeric().withMessage('PIN must be numeric')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFailed(res, errors);

  const email = normalizeEmail(req.body.email);
  const { pin } = req.body;

  const db = getDB();
  if (!db) return dbUnavailable(res);

  try {
    const customer = await db.collection('customers').findOne({ email });
    if (!customer) return res.status(404).json({ success: false, message: 'Email not found' });

    if (!customer.pin) {
      return res.status(401).json({
        success: false,
        message: 'This account has no PIN set yet. Please complete registration.'
      });
    }

    const isMatch = await bcrypt.compare(pin, customer.pin);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid PIN' });

    const lastLoginAt = new Date();
    await db.collection('customers').updateOne(
      { _id: customer._id },
      { $set: { lastLoginAt, updatedAt: lastLoginAt } }
    );

    const token = generateToken(customer._id.toString(), 'customer');

    res.json({
      success: true,
      message: 'Login successful',
      token,
      customer: publicCustomer({ ...customer, lastLoginAt })
    });
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ success: false, message: 'Failed to login' });
  }
});

router.post('/login-phone', loginLimiter, [
  body('phone').notEmpty().withMessage('Phone number required')
    .custom((value) => isValidPhone(value)).withMessage('Invalid phone number format'),
  body('pin').notEmpty().withMessage('PIN required')
    .isLength({ min: 4, max: 4 }).withMessage('PIN must be exactly 4 digits')
    .isNumeric().withMessage('PIN must be numeric')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFailed(res, errors);

  const formattedPhone = formatPhone(req.body.phone);
  const { pin } = req.body;

  const db = getDB();
  if (!db) return dbUnavailable(res);

  try {
    const customer = await db.collection('customers').findOne({ phone: formattedPhone });
    if (!customer) return res.status(404).json({ success: false, message: 'Phone not found' });

    if (!customer.pin) {
      return res.status(401).json({
        success: false,
        message: 'This account has no PIN set yet. Please complete registration.'
      });
    }

    const isMatch = await bcrypt.compare(pin, customer.pin);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid PIN' });

    const lastLoginAt = new Date();
    await db.collection('customers').updateOne(
      { _id: customer._id },
      { $set: { lastLoginAt, updatedAt: lastLoginAt } }
    );

    const token = generateToken(customer._id.toString(), 'customer');

    res.json({
      success: true,
      message: 'Login successful',
      token,
      customer: publicCustomer({ ...customer, lastLoginAt })
    });
  } catch (err) {
    console.error('❌ Phone login error:', err);
    res.status(500).json({ success: false, message: 'Failed to login' });
  }
});

/* ============================================================
   PIN RESET FLOW (forgot PIN -> email OTP -> new PIN)
   ============================================================ */

router.post('/forgot-pin', forgotPinLimiter, [
  body('email').isEmail().withMessage('Valid email required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFailed(res, errors);

  const email = normalizeEmail(req.body.email);
  const db = getDB();
  if (!db) return dbUnavailable(res);

  try {
    const customer = await db.collection('customers').findOne({ email });
    if (!customer) {
      return res.status(404).json({ success: false, message: 'No account found with this email' });
    }

    const cooldown = await checkOtpCooldown(db, email, OTP_PURPOSE.RESET_PIN);
    if (!cooldown.allowed) {
      return res.status(429).json({ success: false, message: cooldown.message });
    }

    const otp = await issueOTP(db, email, OTP_PURPOSE.RESET_PIN);
    const sent = await sendOTPEmail(email, otp, 'reset', customer.name || 'Customer');

    if (!sent) {
      await db.collection('otps').deleteOne({ email, purpose: OTP_PURPOSE.RESET_PIN });
      return res.status(500).json({ success: false, message: 'Failed to send OTP email. Please try again.' });
    }

    console.log(`✅ Reset PIN OTP sent to ${email}`);
    res.json({ success: true, message: 'OTP sent to your email for PIN reset' });
  } catch (err) {
    console.error('❌ Forgot PIN error:', err);
    res.status(500).json({ success: false, message: 'Failed to send reset OTP' });
  }
});

router.post('/reset-pin', [
  body('email').isEmail().withMessage('Valid email required'),
  body('otp').notEmpty().withMessage('OTP required'),
  body('newPin').notEmpty().withMessage('New PIN required')
    .isLength({ min: 4, max: 4 }).withMessage('PIN must be exactly 4 digits')
    .isNumeric().withMessage('PIN must be numeric')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFailed(res, errors);

  const email = normalizeEmail(req.body.email);
  const { otp, newPin } = req.body;

  const db = getDB();
  if (!db) return dbUnavailable(res);

  try {
    const otpResult = await verifyAndConsumeOTP(db, email, OTP_PURPOSE.RESET_PIN, otp);
    if (!otpResult.ok) return res.status(otpResult.status).json({ success: false, message: otpResult.message });

    const hashedPin = await bcrypt.hash(newPin, BCRYPT_ROUNDS);

    const result = await db.collection('customers').updateOne(
      { email },
      { $set: { pin: hashedPin, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    console.log(`✅ PIN reset for: ${email}`);
    res.json({ success: true, message: 'PIN reset successfully. Please login with your new PIN.' });
  } catch (err) {
    console.error('❌ Reset PIN error:', err);
    res.status(500).json({ success: false, message: 'Failed to reset PIN' });
  }
});

/* ============================================================
   GOOGLE SIGN-UP FLOW
   Frontend must send a Google ID token (from Google Identity
   Services / passport-google-oauth's idToken) — it is verified
   server-side below before any account is created or modified.
   ============================================================ */

router.post('/complete-google-registration', [
  body('token').notEmpty().withMessage('Google token required'),
  body('name').notEmpty().withMessage('Name required').isLength({ min: 2, max: 100 }),
  body('phone').notEmpty().withMessage('Phone number required')
    .custom((value) => isValidPhone(value)).withMessage('Invalid phone number format (e.g., 0712345678)'),
  body('pin').notEmpty().withMessage('PIN required')
    .isLength({ min: 4, max: 4 }).withMessage('PIN must be exactly 4 digits')
    .isNumeric().withMessage('PIN must be numeric')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationFailed(res, errors);

  if (!googleClient) {
    console.error('❌ GOOGLE_CLIENT_ID not configured — cannot verify Google tokens');
    return res.status(500).json({ success: false, message: 'Google sign-in is not configured on this server' });
  }

  const { token, name, phone, pin } = req.body;
  const db = getDB();
  if (!db) return dbUnavailable(res);

  try {
    // ===== VERIFY GOOGLE TOKEN (never trust a client-supplied email) =====
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      console.error('❌ Google token verification failed:', verifyErr.message);
      return res.status(401).json({ success: false, message: 'Invalid or expired Google token' });
    }

    if (!payload || !payload.email) {
      return res.status(401).json({ success: false, message: 'Google token did not contain a valid email' });
    }
    if (payload.email_verified === false) {
      return res.status(401).json({ success: false, message: 'Google email is not verified' });
    }

    const email = normalizeEmail(payload.email); // trusted email, straight from Google
    const formattedPhone = formatPhone(phone);

    const existingUser = await db.collection('customers').findOne({
      $or: [{ email }, { phone: formattedPhone }]
    });

    if (existingUser) {
      // Only allowed to "complete" an account that has no PIN yet
      // and that belongs to the same Google-verified email.
      if (existingUser.pin) {
        return res.status(409).json({ success: false, message: 'Email or phone already registered' });
      }
      if (existingUser.email !== email) {
        return res.status(409).json({ success: false, message: 'Phone number already registered to a different account' });
      }

      const hashedPin = await bcrypt.hash(pin, BCRYPT_ROUNDS);
      const lastLoginAt = new Date();

      await db.collection('customers').updateOne(
        { _id: existingUser._id },
        {
          $set: {
            pin: hashedPin,
            phone: formattedPhone,
            name: name.trim(),
            authMethod: 'google',
            googleCompleted: true,
            updatedAt: lastLoginAt,
            lastLoginAt
          }
        }
      );

      const newToken = generateToken(existingUser._id.toString(), 'customer');

      console.log(`✅ Google user PIN set: ${email}`);
      return res.json({
        success: true,
        message: 'PIN set successfully',
        token: newToken,
        customer: publicCustomer({ ...existingUser, name: name.trim(), phone: formattedPhone, lastLoginAt })
      });
    }

    // ===== Brand-new Google-linked account =====
    const hashedPin = await bcrypt.hash(pin, BCRYPT_ROUNDS);
    const now = new Date();

    const customer = {
      email,
      name: name.trim(),
      phone: formattedPhone,
      pin: hashedPin,
      authMethod: 'google',
      googleCompleted: true,
      googleId: payload.sub,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
      orderHistory: [],
      favorites: []
    };

    const result = await db.collection('customers').insertOne(customer);
    const newToken = generateToken(result.insertedId.toString(), 'customer');

    console.log(`✅ Google user registered with PIN: ${email} | ${formattedPhone}`);

    res.json({
      success: true,
      message: 'Account created successfully',
      token: newToken,
      customer: publicCustomer({ ...customer, _id: result.insertedId })
    });
  } catch (err) {
    console.error('❌ Complete Google registration error:', err);
    res.status(500).json({ success: false, message: 'Failed to complete registration' });
  }
});

/* ============================================================
   DEBUG (secured via header/query token — leave DEBUG_TOKEN unset
   in production to disable this route entirely)
   ============================================================ */

router.get('/debug/db-check', async (req, res) => {
  const debugToken = req.headers['x-debug-token'] || req.query.token;
  const expectedToken = process.env.DEBUG_TOKEN;

  if (!expectedToken || debugToken !== expectedToken) {
    return res.status(401).json({ success: false, message: 'Unauthorized - Invalid or missing debug token' });
  }

  try {
    const db = getDB();
    if (!db) return dbUnavailable(res);

    const count = await db.collection('customers').countDocuments();
    const latest = await db.collection('customers')
      .find()
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    res.json({
      success: true,
      database: db.databaseName,
      customerCount: count,
      latest: latest.map((c) => ({
        id: c._id,
        email: c.email,
        name: c.name,
        phone: c.phone,
        authMethod: c.authMethod || 'email',
        createdAt: c.createdAt
      })),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Debug DB check error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
const express = require('express');
const { body, validationResult } = require('express-validator');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { otpLimiter, loginLimiter } = require('../config/rateLimits');
const { sendOTPEmail } = require('../utils/email');
const { isValidEmail } = require('../config/constants');
const { generateToken } = require('../utils/passport');
const { generateOTP, isOTPExpired } = require('../utils/otp');
const bcrypt = require('bcryptjs');

const router = express.Router();

// ==================== HELPER: Validate Phone ====================
function isValidPhone(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length === 10 && (cleaned.startsWith('07') || cleaned.startsWith('01'));
}

function formatPhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10 && (cleaned.startsWith('07') || cleaned.startsWith('01'))) {
    return '254' + cleaned.slice(1);
  }
  return cleaned;
}

// ==================== SEND EMAIL OTP ====================
router.post('/send-email-otp', otpLimiter, [
  body('email').isEmail().withMessage('Valid email required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { email } = req.body;

  const db = getDB();
  if (!db) {
    return res.status(503).json({
      success: false,
      message: 'Database connecting...'
    });
  }

  try {
    const existing = await db.collection('otps').findOne({ email });
    if (existing) {
      const age = (Date.now() - new Date(existing.created_at).getTime()) / 1000 / 60;
      if (age < 2) {
        return res.status(429).json({
          success: false,
          message: 'Please wait 2 minutes before requesting another OTP'
        });
      }
    }

    const otp = generateOTP(6);

    await db.collection('otps').updateOne(
      { email },
      {
        $set: {
          otp,
          created_at: new Date(),
          expires_at: new Date(Date.now() + 10 * 60 * 1000)
        }
      },
      { upsert: true }
    );

    const sent = await sendOTPEmail(email, otp);

    if (sent) {
      res.json({
        success: true,
        message: 'OTP sent successfully to your email'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send OTP email'
      });
    }
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP'
    });
  }
});

// ==================== REGISTER — Create Account with PIN ====================
router.post('/register', [
  body('email').isEmail().withMessage('Valid email required'),
  body('name').notEmpty().withMessage('Name required').isLength({ min: 2, max: 100 }),
  body('phone').notEmpty().withMessage('Phone number required')
    .custom(value => isValidPhone(value)).withMessage('Invalid phone number format (e.g., 0712345678)'),
  body('pin').notEmpty().withMessage('PIN required')
    .isLength({ min: 4, max: 4 }).withMessage('PIN must be exactly 4 digits')
    .isNumeric().withMessage('PIN must be numeric'),
  body('otp').notEmpty().withMessage('OTP required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { email, name, phone, pin, otp } = req.body;

  const db = getDB();
  if (!db) {
    return res.status(503).json({
      success: false,
      message: 'Database connecting...'
    });
  }

  try {
    // Verify OTP
    const stored = await db.collection('otps').findOne({ email });

    if (!stored) {
      return res.status(401).json({
        success: false,
        message: 'No OTP found. Please request a new one.'
      });
    }

    if (isOTPExpired(stored.created_at, 10)) {
      await db.collection('otps').deleteOne({ email });
      return res.status(401).json({
        success: false,
        message: 'OTP expired. Please request a new one.'
      });
    }

    if (stored.otp !== otp) {
      const attempts = (stored.attempts || 0) + 1;
      if (attempts >= 5) {
        await db.collection('otps').deleteOne({ email });
        return res.status(401).json({
          success: false,
          message: 'Too many failed attempts. Please request a new OTP.'
        });
      }
      await db.collection('otps').updateOne(
        { email },
        { $set: { attempts } }
      );
      return res.status(401).json({
        success: false,
        message: `Invalid OTP. ${5 - attempts} attempts remaining.`
      });
    }

    await db.collection('otps').deleteOne({ email });

    // ---------- CHECK IF CUSTOMER EXISTS ----------
    const formattedPhone = formatPhone(phone);
    const emailLower = email.toLowerCase();

    // Check if email already exists
    const existingEmail = await db.collection('customers').findOne({
      email: emailLower
    });

    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered. Please login.'
      });
    }

    // Check if phone already exists
    const existingPhone = await db.collection('customers').findOne({
      phone: formattedPhone
    });

    if (existingPhone) {
      return res.status(409).json({
        success: false,
        message: 'Phone number already registered. Please login.'
      });
    }

    // ---------- HASH PIN ----------
    const hashedPin = await bcrypt.hash(pin, 10);

    // ---------- CREATE CUSTOMER WITH PHONE ----------
    const newCustomer = {
      email: emailLower,
      name: name,
      phone: formattedPhone,  // ✅ Phone saved here
      pin: hashedPin,
      createdAt: new Date(),
      updatedAt: new Date(),
      orderHistory: [],
      favorites: []
    };

    const result = await db.collection('customers').insertOne(newCustomer);
    const customer = { _id: result.insertedId, ...newCustomer };
    console.log(`✅ New customer registered: ${email} | ${formattedPhone}`);

    // ---------- GENERATE JWT ----------
    const token = generateToken(customer._id.toString(), 'customer');

    res.json({
      success: true,
      message: 'Account created successfully',
      token,
      customer: {
        id: customer._id,
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        createdAt: customer.createdAt
      }
    });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create account'
    });
  }
});

// ==================== LOGIN WITH EMAIL + PIN ====================
router.post('/login', loginLimiter, [
  body('email').isEmail().withMessage('Valid email required'),
  body('pin').notEmpty().withMessage('PIN required')
    .isLength({ min: 4, max: 4 }).withMessage('PIN must be exactly 4 digits')
    .isNumeric().withMessage('PIN must be numeric')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { email, pin } = req.body;

  const db = getDB();
  if (!db) {
    return res.status(503).json({
      success: false,
      message: 'Database connecting...'
    });
  }

  try {
    const customer = await db.collection('customers').findOne({
      email: email.toLowerCase()
    });

    if (!customer) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or PIN'
      });
    }

    if (!customer.pin) {
      return res.status(401).json({
        success: false,
        message: 'Account has no PIN set. Please register.'
      });
    }

    const isMatch = await bcrypt.compare(pin, customer.pin);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or PIN'
      });
    }

    const token = generateToken(customer._id.toString(), 'customer');

    res.json({
      success: true,
      message: 'Login successful',
      token,
      customer: {
        id: customer._id,
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        createdAt: customer.createdAt
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to login'
    });
  }
});

// ==================== LOGIN WITH PHONE + PIN ====================
router.post('/login-phone', loginLimiter, [
  body('phone').notEmpty().withMessage('Phone number required')
    .custom(value => isValidPhone(value)).withMessage('Invalid phone number format'),
  body('pin').notEmpty().withMessage('PIN required')
    .isLength({ min: 4, max: 4 }).withMessage('PIN must be exactly 4 digits')
    .isNumeric().withMessage('PIN must be numeric')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { phone, pin } = req.body;

  const db = getDB();
  if (!db) {
    return res.status(503).json({
      success: false,
      message: 'Database connecting...'
    });
  }

  try {
    const formattedPhone = formatPhone(phone);

    const customer = await db.collection('customers').findOne({
      phone: formattedPhone
    });

    if (!customer) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone or PIN'
      });
    }

    if (!customer.pin) {
      return res.status(401).json({
        success: false,
        message: 'Account has no PIN set. Please register.'
      });
    }

    const isMatch = await bcrypt.compare(pin, customer.pin);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone or PIN'
      });
    }

    const token = generateToken(customer._id.toString(), 'customer');

    res.json({
      success: true,
      message: 'Login successful',
      token,
      customer: {
        id: customer._id,
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        createdAt: customer.createdAt
      }
    });

  } catch (err) {
    console.error('Phone login error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to login'
    });
  }
});

// ==================== FORGOT PIN — Send OTP ====================
router.post('/forgot-pin', [
  body('email').isEmail().withMessage('Valid email required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { email } = req.body;

  const db = getDB();
  if (!db) {
    return res.status(503).json({
      success: false,
      message: 'Database connecting...'
    });
  }

  try {
    const customer = await db.collection('customers').findOne({
      email: email.toLowerCase()
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email'
      });
    }

    const otp = generateOTP(6);

    await db.collection('otps').updateOne(
      { email },
      {
        $set: {
          otp,
          created_at: new Date(),
          expires_at: new Date(Date.now() + 10 * 60 * 1000),
          purpose: 'reset_pin'
        }
      },
      { upsert: true }
    );

    await sendOTPEmail(email, otp);

    res.json({
      success: true,
      message: 'OTP sent to your email for PIN reset'
    });

  } catch (err) {
    console.error('Forgot PIN error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to send reset OTP'
    });
  }
});

// ==================== RESET PIN — With OTP ====================
router.post('/reset-pin', [
  body('email').isEmail().withMessage('Valid email required'),
  body('otp').notEmpty().withMessage('OTP required'),
  body('newPin').notEmpty().withMessage('New PIN required')
    .isLength({ min: 4, max: 4 }).withMessage('PIN must be exactly 4 digits')
    .isNumeric().withMessage('PIN must be numeric')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { email, otp, newPin } = req.body;

  const db = getDB();
  if (!db) {
    return res.status(503).json({
      success: false,
      message: 'Database connecting...'
    });
  }

  try {
    // Verify OTP
    const stored = await db.collection('otps').findOne({ 
      email,
      purpose: 'reset_pin'
    });

    if (!stored) {
      return res.status(401).json({
        success: false,
        message: 'No OTP found. Please request a new one.'
      });
    }

    if (isOTPExpired(stored.created_at, 10)) {
      await db.collection('otps').deleteOne({ email });
      return res.status(401).json({
        success: false,
        message: 'OTP expired. Please request a new one.'
      });
    }

    if (stored.otp !== otp) {
      const attempts = (stored.attempts || 0) + 1;
      if (attempts >= 5) {
        await db.collection('otps').deleteOne({ email });
        return res.status(401).json({
          success: false,
          message: 'Too many failed attempts. Please request a new OTP.'
        });
      }
      await db.collection('otps').updateOne(
        { email },
        { $set: { attempts } }
      );
      return res.status(401).json({
        success: false,
        message: `Invalid OTP. ${5 - attempts} attempts remaining.`
      });
    }

    await db.collection('otps').deleteOne({ email });

    // ---------- UPDATE PIN ----------
    const hashedPin = await bcrypt.hash(newPin, 10);

    const result = await db.collection('customers').updateOne(
      { email: email.toLowerCase() },
      { $set: { pin: hashedPin, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    console.log(`✅ PIN reset for: ${email}`);

    res.json({
      success: true,
      message: 'PIN reset successfully. Please login with your new PIN.'
    });

  } catch (err) {
    console.error('Reset PIN error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to reset PIN'
    });
  }
});

module.exports = router;
const express = require('express');
const { body, validationResult } = require('express-validator');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { otpLimiter, loginLimiter, forgotPinLimiter } = require('../config/rateLimits'); // ← ADDED forgotPinLimiter
const { sendOTPEmail } = require('../utils/email');
const { isValidEmail } = require('../config/constants');
const { generateToken } = require('../config/passport');
const { generateOTP, isOTPExpired } = require('../utils/otp');
const bcrypt = require('bcryptjs');

const router = express.Router();

// ==================== HELPER: Validate Phone ====================
function isValidPhone(phone) {
  if (!phone) return false;
  
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.length === 10 && (cleaned.startsWith('07') || cleaned.startsWith('01'))) {
    return true;
  }
  if (cleaned.length === 9 && (cleaned.startsWith('7') || cleaned.startsWith('1'))) {
    return true;
  }
  if (cleaned.length === 12 && cleaned.startsWith('254')) {
    return true;
  }
  
  return false;
}

function formatPhone(phone) {
  if (!phone) return '';
  
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.length === 12 && cleaned.startsWith('254')) {
    return cleaned;
  }
  
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
  
  if (cleaned.length === 12 && cleaned.startsWith('254')) {
    return '0' + cleaned.slice(3);
  }
  
  return phone;
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
      const isExpired = new Date() > new Date(existing.expires_at);
      const age = (Date.now() - new Date(existing.created_at).getTime()) / 1000 / 60;
      
      if (!isExpired && age < 2) {
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
    // ===== VERIFY OTP =====
    const stored = await db.collection('otps').findOne({ email: email.toLowerCase() });

    if (!stored) {
      return res.status(401).json({
        success: false,
        message: 'No OTP found. Please request a new one.'
      });
    }

    if (isOTPExpired(stored.created_at, 10)) {
      await db.collection('otps').deleteOne({ email: email.toLowerCase() });
      return res.status(401).json({
        success: false,
        message: 'OTP expired. Please request a new one.'
      });
    }

    if (stored.otp !== otp) {
      const attempts = (stored.attempts || 0) + 1;
      if (attempts >= 5) {
        await db.collection('otps').deleteOne({ email: email.toLowerCase() });
        return res.status(401).json({
          success: false,
          message: 'Too many failed attempts. Please request a new OTP.'
        });
      }
      await db.collection('otps').updateOne(
        { email: email.toLowerCase() },
        { $set: { attempts } }
      );
      return res.status(401).json({
        success: false,
        message: `Invalid OTP. ${5 - attempts} attempts remaining.`
      });
    }

    // ===== DELETE USED OTP =====
    await db.collection('otps').deleteOne({ email: email.toLowerCase() });

    // ===== CHECK IF USER EXISTS =====
    const existingUser = await db.collection('customers').findOne({
      $or: [
        { email: email.toLowerCase() },
        { phone: formatPhone(phone) }
      ]
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Email or phone already registered. Please login.'
      });
    }

    // ===== HASH PIN =====
    const hashedPin = await bcrypt.hash(pin, 10);

    // ===== CREATE CUSTOMER =====
    const customer = {
      email: email.toLowerCase(),
      name: name.trim(),
      phone: formatPhone(phone),
      pin: hashedPin,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
      orderHistory: [],
      favorites: []
    };

    const result = await db.collection('customers').insertOne(customer);

    // ===== GENERATE JWT =====
    const token = generateToken(result.insertedId.toString(), 'customer');

    console.log(`✅ New customer registered: ${email} | ${formatPhone(phone)}`);

    res.json({
      success: true,
      message: 'Account created successfully',
      token,
      customer: {
        id: result.insertedId,
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        createdAt: customer.createdAt
      }
    });

  } catch (err) {
    console.error('❌ Register error:', err);
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
    const emailLower = email.toLowerCase();

    const customer = await db.collection('customers').findOne({
      email: emailLower
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

    // ===== UPDATE LAST LOGIN =====
    await db.collection('customers').updateOne(
      { _id: customer._id },
      {
        $set: {
          lastLoginAt: new Date(),
          updatedAt: new Date()
        }
      }
    );

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
        createdAt: customer.createdAt,
        lastLoginAt: new Date()
      }
    });

  } catch (err) {
    console.error('❌ Login error:', err);
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

    // ===== UPDATE LAST LOGIN =====
    await db.collection('customers').updateOne(
      { _id: customer._id },
      {
        $set: {
          lastLoginAt: new Date(),
          updatedAt: new Date()
        }
      }
    );

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
        createdAt: customer.createdAt,
        lastLoginAt: new Date()
      }
    });

  } catch (err) {
    console.error('❌ Phone login error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to login'
    });
  }
});

// ==================== FORGOT PIN — Send OTP ====================
router.post('/forgot-pin', forgotPinLimiter, [
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
    const emailLower = email.toLowerCase();

    const customer = await db.collection('customers').findOne({
      email: emailLower
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email'
      });
    }

    const existingOtp = await db.collection('otps').findOne({
      email: emailLower,
      purpose: 'reset_pin'
    });

    if (existingOtp) {
      const isExpired = new Date() > new Date(existingOtp.expires_at);
      const age = (Date.now() - new Date(existingOtp.created_at).getTime()) / 1000 / 60;

      if (!isExpired && age < 2) {
        return res.status(429).json({
          success: false,
          message: 'Please wait 2 minutes before requesting another OTP'
        });
      }

      if (isExpired) {
        await db.collection('otps').deleteOne({ _id: existingOtp._id });
      }
    }

    const otp = generateOTP(6);

    await db.collection('otps').updateOne(
      { email: emailLower },
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

    const sent = await sendOTPEmail(email, otp, 'reset', customer.name || 'Customer');

    if (!sent) {
      await db.collection('otps').deleteOne({ email: emailLower, otp });
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP email. Please try again.'
      });
    }

    console.log(`✅ Reset PIN OTP sent to ${email}`);
    res.json({
      success: true,
      message: 'OTP sent to your email for PIN reset'
    });

  } catch (err) {
    console.error('❌ Forgot PIN error:', err);
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
  const emailLower = email.toLowerCase();

  const db = getDB();
  if (!db) {
    return res.status(503).json({
      success: false,
      message: 'Database connecting...'
    });
  }

  try {
    const stored = await db.collection('otps').findOne({ 
      email: emailLower,
      purpose: 'reset_pin'
    });

    if (!stored) {
      return res.status(401).json({
        success: false,
        message: 'No OTP found. Please request a new one.'
      });
    }

    if (isOTPExpired(stored.created_at, 10)) {
      await db.collection('otps').deleteOne({ email: emailLower });
      return res.status(401).json({
        success: false,
        message: 'OTP expired. Please request a new one.'
      });
    }

    if (stored.otp !== otp) {
      const attempts = (stored.attempts || 0) + 1;
      if (attempts >= 5) {
        await db.collection('otps').deleteOne({ email: emailLower });
        return res.status(401).json({
          success: false,
          message: 'Too many failed attempts. Please request a new OTP.'
        });
      }
      await db.collection('otps').updateOne(
        { email: emailLower },
        { $set: { attempts } }
      );
      return res.status(401).json({
        success: false,
        message: `Invalid OTP. ${5 - attempts} attempts remaining.`
      });
    }

    await db.collection('otps').deleteOne({ email: emailLower });

    const hashedPin = await bcrypt.hash(newPin, 10);

    const result = await db.collection('customers').updateOne(
      { email: emailLower },
      { 
        $set: { 
          pin: hashedPin, 
          updatedAt: new Date() 
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    console.log(`✅ PIN reset for: ${emailLower}`);

    res.json({
      success: true,
      message: 'PIN reset successfully. Please login with your new PIN.'
    });

  } catch (err) {
    console.error('❌ Reset PIN error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to reset PIN'
    });
  }
});

module.exports = router;
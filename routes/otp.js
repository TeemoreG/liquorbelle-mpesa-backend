const express = require('express');
const { body, validationResult } = require('express-validator');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { otpLimiter } = require('../config/rateLimits');
const { sendOTPEmail } = require('../utils/email');
const { isValidEmail } = require('../config/constants');
const { generateToken } = require('../config/passport');
const { generateOTP, isOTPExpired } = require('../utils/otp');
const bcrypt = require('bcryptjs');

const router = express.Router();

// ==================== SEND OTP (Backend Generates) ====================
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

// ==================== VERIFY OTP ====================
router.post('/verify-otp', [
  body('email').isEmail().withMessage('Valid email required'),
  body('otp').notEmpty().withMessage('OTP required'),
  body('name').optional().isString().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('phone').optional().isString().matches(/^[0-9]{10,12}$/).withMessage('Phone must be 10-12 digits'),
  body('pin').optional().isString().isLength({ min: 4, max: 4 }).withMessage('PIN must be exactly 4 digits')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { email, otp, name, phone, pin } = req.body;

  const db = getDB();
  if (!db) {
    return res.status(503).json({
      success: false,
      message: 'Database connecting...'
    });
  }

  try {
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

    let customer = await db.collection('customers').findOne({
      email: email.toLowerCase()
    });

    // Hash PIN if provided
    let hashedPin = null;
    if (pin) {
      hashedPin = await bcrypt.hash(pin, 10);
    }

    if (!customer) {
      // NEW CUSTOMER - create with PIN
      const newCustomer = {
        email: email.toLowerCase(),
        name: name || email.split('@')[0] || 'Customer',
        phone: phone || '',
        pin: hashedPin, // ← Store hashed PIN
        authMethod: 'email',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: new Date(),
        orderHistory: [],
        favorites: []
      };

      const result = await db.collection('customers').insertOne(newCustomer);
      customer = { _id: result.insertedId, ...newCustomer };
      console.log(`✅ New customer created with PIN: ${email}`);
    } else {
      // EXISTING CUSTOMER - update fields, preserve PIN if not provided
      const updates = {};
      if (name) updates.name = name;
      if (phone) updates.phone = phone;
      if (hashedPin) updates.pin = hashedPin; // ← Update PIN if provided
      updates.updatedAt = new Date();
      updates.lastLoginAt = new Date();

      if (Object.keys(updates).length > 0) {
        await db.collection('customers').updateOne(
          { email: email.toLowerCase() },
          { $set: updates }
        );
        customer = { ...customer, ...updates };
        console.log(`✅ Customer updated: ${email}`);
      }
    }

    const token = generateToken(customer._id.toString(), 'customer');

    res.json({
      success: true,
      message: 'Verified successfully',
      token,
      customer: {
        id: customer._id,
        email: customer.email,
        name: customer.name,
        phone: customer.phone || '',
        hasPin: !!customer.pin, // ← Send back whether user has PIN
        createdAt: customer.createdAt
      }
    });

  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP'
    });
  }
});

// ==================== REFRESH TOKEN ====================
router.post('/refresh-token', [
  body('token').notEmpty().withMessage('Token required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { token } = req.body;

  try {
    const { verifyToken, generateToken } = require('../config/passport');
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    const db = getDB();
    if (!db) {
      return res.status(503).json({
        success: false,
        message: 'Database connecting...'
      });
    }

    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(decoded.userId)
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const newToken = generateToken(customer._id.toString(), 'customer');

    res.json({
      success: true,
      token: newToken,
      customer: {
        id: customer._id,
        email: customer.email,
        name: customer.name,
        phone: customer.phone || '',
        hasPin: !!customer.pin
      }
    });
  } catch (err) {
    console.error('Refresh token error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh token'
    });
  }
});

module.exports = router;
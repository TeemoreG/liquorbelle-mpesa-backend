const express = require('express');
const { getDB } = require('../config/database');
const { otpLimiter } = require('../config/rateLimits');
const { sendOTPEmail } = require('../utils/email');
const { isValidEmail } = require('../config/constants');

const router = express.Router();

// ==================== SEND PHONE OTP (SMS) ====================
router.post('/send-phone-otp', otpLimiter, async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ success: false, message: 'Phone and OTP required' });
  }

  const db = getDB();
  if (!db) {
    return res.status(503).json({ success: false, message: 'Database connecting...' });
  }

  try {
    // Store OTP with phone as key
    await db.collection('otps').updateOne(
      { phone: phone },
      { $set: { phone, otp, created_at: new Date() } },
      { upsert: true }
    );

    // Log OTP for debugging
    console.log(`📱 OTP for ${phone}: ${otp}`);

    // TODO: Integrate with SMS service (Africa's Talking, Twilio, etc.)
    // await sendSMS(phone, `Your LiquorBelle verification code is: ${otp}`);

    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    console.error('Phone OTP error:', err);
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

// ==================== VERIFY PHONE OTP ====================
router.post('/verify-phone-otp', async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({ success: false, message: 'Phone and OTP required' });
  }

  const db = getDB();
  if (!db) {
    return res.status(503).json({ success: false, message: 'Database connecting...' });
  }

  try {
    const stored = await db.collection('otps').findOne({ phone });

    if (!stored || stored.otp !== otp) {
      return res.status(401).json({ success: false, message: 'Invalid OTP' });
    }

    // Delete used OTP
    await db.collection('otps').deleteOne({ phone });

    res.json({ success: true });
  } catch (err) {
    console.error('Verify phone OTP error:', err);
    res.status(500).json({ success: false, message: 'Failed to verify OTP' });
  }
});

// ==================== CHECK IF CUSTOMER EXISTS ====================
router.post('/customer-exists', async (req, res) => {
  const { phone, email } = req.body;

  if (!phone && !email) {
    return res.status(400).json({ success: false, message: 'Phone or email required' });
  }

  const db = getDB();
  if (!db) {
    return res.status(503).json({ success: false, message: 'Database connecting...' });
  }

  try {
    const query = {};
    if (phone) query.phone = phone;
    if (email) query.email = email.toLowerCase();

    const customer = await db.collection('customers').findOne(query);

    res.json({
      success: true,
      exists: !!customer,
      customer: customer || null
    });
  } catch (err) {
    console.error('Customer exists error:', err);
    res.status(500).json({ success: false, message: 'Failed to check customer' });
  }
});

// ==================== GET CUSTOMER BY PHONE ====================
router.get('/customers/phone/:phone', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const { phone } = req.params;

    const customer = await db.collection('customers').findOne({ phone });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    res.json({ success: true, customer });
  } catch (err) {
    console.error('Error fetching customer by phone:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch customer' });
  }
});

module.exports = router;
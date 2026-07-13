const express = require('express');
const { getDB } = require('../config/database');
const { otpLimiter } = require('../config/rateLimits');
const { sendOTPEmail } = require('../utils/email');
const { isValidEmail } = require('../config/constants');

const router = express.Router();

// ==================== SEND OTP ====================
router.post('/send-email-otp', otpLimiter, async (req, res) => {
  const { email, otp } = req.body;

  if (!isValidEmail(email)) {
    return res.json({ success: false, message: 'Invalid email format' });
  }

  const db = getDB();
  if (!db) {
    return res.json({ success: false, message: 'Database connecting...' });
  }

  try {
    await db.collection('otps').updateOne(
      { email },
      { $set: { otp, created_at: new Date() } },
      { upsert: true }
    );

    const sent = await sendOTPEmail(email, otp);

    if (sent) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: 'Failed to send OTP email' });
    }
  } catch (err) {
    console.error('OTP error:', err);
    res.json({ success: false, message: 'Failed to send OTP' });
  }
});

// ==================== VERIFY OTP ====================
router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.json({ success: false, message: 'Email and OTP required' });
  }

  const db = getDB();
  if (!db) {
    return res.json({ success: false, message: 'Database connecting...' });
  }

  try {
    const stored = await db.collection('otps').findOne({ email });

    if (!stored || stored.otp !== otp) {
      return res.json({ success: false, message: 'Invalid OTP' });
    }

    await db.collection('otps').deleteOne({ email });

    res.json({ success: true });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.json({ success: false, message: 'Failed to verify OTP' });
  }
});

module.exports = router;
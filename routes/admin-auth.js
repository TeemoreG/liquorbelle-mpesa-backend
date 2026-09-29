const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDB } = require('../config/database');
const { generateToken } = require('../config/passport');
const { loginLimiter } = require('../config/rateLimits');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Constant-time string compare to prevent timing attacks
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Admin login - bcrypt against admin_settings.admin_credentials
router.post('/login', loginLimiter, async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, message: 'Password required' });
  }

  const db = getDB();
  if (!db) {
    return res.status(503).json({ success: false, message: 'Database connecting...' });
  }

  try {
    const adminSettings = await db.collection('admin_settings').findOne({ key: 'admin_credentials' });

    if (!adminSettings || !adminSettings.password) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const isMatch = await bcrypt.compare(password, adminSettings.password);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const token = generateToken('admin', 'admin');

    res.json({
      success: true,
      message: 'Admin login successful',
      token,
      admin: { id: 'admin', role: 'admin' }
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ success: false, message: 'Failed to login' });
  }
});

// Cashier login - constant-time compare against CASHIER_PASSWORD env var
router.post('/cashier/login', loginLimiter, async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, message: 'Password required' });
  }

  const expected = process.env.CASHIER_PASSWORD;

  if (!expected) {
    console.error('CASHIER_PASSWORD env var not set');
    return res.status(503).json({ success: false, message: 'Cashier login not configured' });
  }

  if (!safeCompare(password, expected)) {
    return res.status(401).json({ success: false, message: 'Invalid cashier credentials' });
  }

  try {
    const token = generateToken('cashier', 'cashier');

    res.json({
      success: true,
      message: 'Cashier login successful',
      token,
      cashier: { id: 'cashier', role: 'cashier' }
    });
  } catch (err) {
    console.error('Cashier login error:', err);
    res.status(500).json({ success: false, message: 'Failed to login' });
  }
});

// Update admin and/or cashier passwords - admin only
router.post('/update-passwords', requireAdmin, async (req, res) => {
  const { adminPassword, cashierPassword } = req.body;

  if (!adminPassword && !cashierPassword) {
    return res.status(400).json({ success: false, message: 'Provide adminPassword and/or cashierPassword' });
  }

  if (adminPassword && adminPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'Admin password must be at least 6 characters' });
  }

  if (cashierPassword && cashierPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'Cashier password must be at least 6 characters' });
  }

  const db = getDB();
  if (!db) {
    return res.status(503).json({ success: false, message: 'Database connecting...' });
  }

  try {
    const updated = [];

    if (adminPassword) {
      const hash = await bcrypt.hash(adminPassword, 10);
      await db.collection('admin_settings').updateOne(
        { key: 'admin_credentials' },
        { $set: { key: 'admin_credentials', password: hash, updated_at: new Date() } },
        { upsert: true }
      );
      updated.push('admin');
    }

    if (cashierPassword) {
      const hash = await bcrypt.hash(cashierPassword, 10);
      await db.collection('admin_settings').updateOne(
        { key: 'cashier_credentials' },
        { $set: { key: 'cashier_credentials', password: hash, updated_at: new Date() } },
        { upsert: true }
      );
      updated.push('cashier');
    }

    res.json({
      success: true,
      message: 'Updated: ' + updated.join(', '),
      updated
    });
  } catch (err) {
    console.error('Update passwords error:', err);
    res.status(500).json({ success: false, message: 'Failed to update passwords' });
  }
});

module.exports = router;
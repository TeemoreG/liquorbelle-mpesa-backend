const express = require('express');
const { getDB } = require('../config/database');
const { generateToken } = require('../config/passport');
const { loginLimiter } = require('../config/rateLimits');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Plain string compare - both passwords stored as plaintext in DB
function matchPlain(input, stored) {
  if (typeof input !== 'string' || typeof stored !== 'string') return false;
  if (input.length !== stored.length) return false;
  return input === stored;
}

// Admin login - plaintext compare against admin_settings.admin_credentials
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
    const doc = await db.collection('admin_settings').findOne({ key: 'admin_credentials' });

    if (!doc || !doc.password) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    if (!matchPlain(password, doc.password)) {
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

// Cashier login - plaintext compare against admin_settings.cashier_credentials
router.post('/cashier/login', loginLimiter, async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, message: 'Password required' });
  }

  const db = getDB();
  if (!db) {
    return res.status(503).json({ success: false, message: 'Database connecting...' });
  }

  try {
    const doc = await db.collection('admin_settings').findOne({ key: 'cashier_credentials' });

    if (!doc || !doc.password) {
      return res.status(401).json({ success: false, message: 'Invalid cashier credentials' });
    }

    if (!matchPlain(password, doc.password)) {
      return res.status(401).json({ success: false, message: 'Invalid cashier credentials' });
    }

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

// Update passwords - admin only, both plaintext
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
      await db.collection('admin_settings').updateOne(
        { key: 'admin_credentials' },
        { $set: { key: 'admin_credentials', password: adminPassword, updated_at: new Date() } },
        { upsert: true }
      );
      updated.push('admin');
    }

    if (cashierPassword) {
      await db.collection('admin_settings').updateOne(
        { key: 'cashier_credentials' },
        { $set: { key: 'cashier_credentials', password: cashierPassword, updated_at: new Date() } },
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
const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB } = require('../config/database');
const { generateToken } = require('../config/passport');
const { loginLimiter } = require('../config/rateLimits');

const router = express.Router();

// ==================== ADMIN LOGIN ====================
router.post('/login', loginLimiter, async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({
      success: false,
      message: 'Password required'
    });
  }

  const db = getDB();
  if (!db) {
    return res.status(503).json({
      success: false,
      message: 'Database connecting...'
    });
  }

  try {
    // Get admin credentials from admin_settings
    const adminSettings = await db.collection('admin_settings').findOne({
      key: 'admin_credentials'
    });

    if (!adminSettings || !adminSettings.password) {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials'
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, adminSettings.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin credentials'
      });
    }

    // Generate token
    const token = generateToken('admin', 'admin');

    res.json({
      success: true,
      message: 'Admin login successful',
      token,
      admin: {
        id: 'admin',
        role: 'admin'
      }
    });

  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to login'
    });
  }
});

module.exports = router;
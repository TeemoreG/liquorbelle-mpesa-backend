const express = require('express');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDB } = require('../config/database');
const { verifyPassword, updatePasswords, getActivePasswords } = require('../utils/passwords');
const { requireAdmin } = require('../middleware/auth');
const { loginLimiter } = require('../config/rateLimits');
const { isValidEmail } = require('../config/constants');
const { generateToken } = require('../config/passport');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

// ==================== ADMIN LOGIN ====================
router.post('/admin/login', loginLimiter, async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, message: 'Password required' });
  }

  const isValid = await verifyPassword(password, 'admin');

  if (isValid) {
    const token = generateToken('admin', 'admin', '1d');
    return res.json({ success: true, token, role: 'admin' });
  }

  res.status(401).json({ success: false, message: 'Invalid admin password' });
});

// ==================== CASHIER LOGIN ====================
router.post('/cashier/login', loginLimiter, async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, message: 'Password required' });
  }

  const isValid = await verifyPassword(password, 'cashier');

  if (isValid) {
    const token = generateToken('cashier', 'cashier', '1d');
    return res.json({ success: true, token, role: 'cashier' });
  }

  res.status(401).json({ success: false, message: 'Invalid cashier password' });
});

// ==================== CUSTOMER REGISTRATION ====================
router.post('/customers/register', [
  body('email').isEmail().withMessage('Valid email required'),
  body('name').notEmpty().withMessage('Name required'),
  body('phone').notEmpty().withMessage('Phone required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const { email, name, phone, address } = req.body;

    const existing = await db.collection('customers').findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.json({ success: true, customer: existing, message: 'Customer already exists' });
    }

    const customer = {
      email: email.toLowerCase(),
      name,
      phone,
      address: address || '',
      orderHistory: [],
      favorites: [],
      created_at: new Date(),
      updated_at: new Date()
    };

    await db.collection('customers').insertOne(customer);
    res.json({ success: true, customer });
  } catch (err) {
    console.error('Error registering customer:', err);
    res.status(500).json({ success: false, message: 'Failed to register customer' });
  }
});

// ==================== CUSTOMER LOGIN ====================
router.post('/customers/login', loginLimiter, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email required' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email format' });
  }

  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const customer = await db.collection('customers').findOne({ email: email.toLowerCase() });

    if (!customer) {
      return res.status(401).json({ success: false, message: 'Customer not found. Please register first.' });
    }

    const token = generateToken(customer._id, 'customer', '7d');

    res.json({
      success: true,
      token,
      role: 'customer',
      customer: {
        id: customer._id,
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        address: customer.address
      }
    });
  } catch (err) {
    console.error('Customer login error:', err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// ==================== UPDATE PASSWORDS (Admin only) ====================
router.post('/admin/update-passwords', requireAdmin, async (req, res) => {
  try {
    const { adminPassword, cashierPassword } = req.body;

    if (!adminPassword && !cashierPassword) {
      return res.status(400).json({ success: false, message: 'At least one password required' });
    }

    await updatePasswords(adminPassword, cashierPassword);

    console.log('Passwords updated successfully');
    res.json({ success: true, message: 'Passwords updated successfully. Old passwords will no longer work.' });
  } catch (err) {
    console.error('Error updating passwords:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to update passwords' });
  }
});

// ==================== VERIFY ADMIN/ CASHIER ====================
router.post('/admin/verify', async (req, res) => {
  const { password, type } = req.body;
  const isValid = await verifyPassword(password, type || 'admin');
  res.json({ success: isValid });
});

module.exports = router;
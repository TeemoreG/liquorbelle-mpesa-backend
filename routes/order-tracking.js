const express = require('express');
const { getDB } = require('../config/database');
const { orderCache } = require('../utils/cache');
const { isValidEmail } = require('../config/constants');

const router = express.Router();

// ==================== TRACK ORDERS BY EMAIL + OTP ====================
router.post('/track', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const { email, otp } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
    }

    // Verify OTP
    const stored = await db.collection('otps').findOne({ email: email.toLowerCase() });

    if (!stored || stored.otp !== otp) {
      return res.status(401).json({ success: false, message: 'Invalid OTP' });
    }

    // Delete used OTP
    await db.collection('otps').deleteOne({ email: email.toLowerCase() });

    // Check cache
    const cacheKey = 'orders_' + email.toLowerCase();
    const cached = orderCache.get(cacheKey);

    if (cached) {
      return res.json({ success: true, orders: cached, fromCache: true });
    }

    // Fetch orders
    const orders = await db.collection('orders')
      .find({ customer_email: email.toLowerCase() })
      .sort({ created_at: -1 })
      .toArray();

    orderCache.set(cacheKey, orders);
    res.json({ success: true, orders });
  } catch (err) {
    console.error('Track orders error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

// ==================== TRACK SINGLE ORDER BY ID ====================
router.get('/:orderId', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const { orderId } = req.params;

    const order = await db.collection('orders').findOne({ order_number: orderId });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    res.json({ success: true, order });
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
});

module.exports = router;
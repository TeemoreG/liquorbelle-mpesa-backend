const express = require('express');
const { body, validationResult } = require('express-validator');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { requireCustomer } = require('../middleware/auth');
const { isValidEmail } = require('../config/constants');

const router = express.Router();

// ==================== GET CUSTOMER BY EMAIL ====================
router.get('/:email', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const { email } = req.params;

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    const customer = await db.collection('customers').findOne({ email: email.toLowerCase() });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    res.json({ success: true, customer });
  } catch (err) {
    console.error('Error fetching customer:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch customer' });
  }
});

// ==================== UPDATE CUSTOMER PROFILE ====================
router.put('/:email', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const { email } = req.params;
    const { name, phone, address } = req.body;

    if (req.customer.email !== email.toLowerCase()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const updateData = {
      updated_at: new Date()
    };

    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (address !== undefined) updateData.address = address;

    const result = await db.collection('customers').updateOne(
      { email: email.toLowerCase() },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error updating customer:', err);
    res.status(500).json({ success: false, message: 'Failed to update customer' });
  }
});

// ==================== TOGGLE FAVORITE ====================
router.put('/:email/favorites', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const { email } = req.params;
    const { productId } = req.body;

    if (req.customer.email !== email.toLowerCase()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (!productId) {
      return res.status(400).json({ success: false, message: 'Product ID required' });
    }

    const customer = await db.collection('customers').findOne({ email: email.toLowerCase() });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const favorites = customer.favorites || [];
    const index = favorites.indexOf(productId);

    if (index > -1) {
      favorites.splice(index, 1);
    } else {
      favorites.push(productId);
    }

    await db.collection('customers').updateOne(
      { email: email.toLowerCase() },
      { $set: { favorites, updated_at: new Date() } }
    );

    res.json({ success: true, favorites });
  } catch (err) {
    console.error('Error updating favorites:', err);
    res.status(500).json({ success: false, message: 'Failed to update favorites' });
  }
});

// ==================== GET CUSTOMER ORDERS ====================
router.get('/:email/orders', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const { email } = req.params;

    if (req.customer.email !== email.toLowerCase()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const orders = await db.collection('orders')
      .find({ customer_email: email.toLowerCase() })
      .sort({ created_at: -1 })
      .toArray();

    res.json({ success: true, orders });
  } catch (err) {
    console.error('Error fetching customer orders:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

// ==================== ADD ORDER TO HISTORY ====================
router.post('/:email/history', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const { email } = req.params;
    const { orderId } = req.body;

    if (req.customer.email !== email.toLowerCase()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Order ID required' });
    }

    const result = await db.collection('customers').updateOne(
      { email: email.toLowerCase() },
      { 
        $addToSet: { orderHistory: orderId },
        $set: { updated_at: new Date() }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error adding order to history:', err);
    res.status(500).json({ success: false, message: 'Failed to update history' });
  }
});

module.exports = router;
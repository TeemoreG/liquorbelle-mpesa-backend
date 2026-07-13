const express = require('express');
const { body, validationResult } = require('express-validator');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { requireAdmin, requireAdminOrCashier } = require('../middleware/auth');
const { orderCache, clearOrderCache } = require('../utils/cache');
const { sendMpesaOrderReceivedEmail, sendOrderDeliveredEmail } = require('../utils/email');
const { orderCreateLimiter } = require('../config/rateLimits');

const router = express.Router();

// ==================== GET ALL ORDERS (Admin) ====================
router.get('/', requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const cached = orderCache.get('all_orders');
    if (cached) {
      return res.json({ success: true, orders: cached, fromCache: true });
    }

    const orders = await db.collection('orders').find({}).sort({ created_at: -1 }).toArray();
    orderCache.set('all_orders', orders);
    res.json({ success: true, orders });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

// ==================== GET ALL ORDERS (Admin/Cashier with filters) ====================
router.get('/all', requireAdminOrCashier, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const { limit = 1000, status, days } = req.query;

    const cacheKey = 'all_orders_' + (status || 'all') + '_' + (days || 'all');
    const cached = orderCache.get(cacheKey);
    if (cached) {
      return res.json({ success: true, orders: cached, count: cached.length, fromCache: true });
    }

    let query = {};
    if (status && status !== 'all') {
      query.status = status;
    }
    if (days && days !== 'all') {
      const daysAgo = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);
      query.created_at = { $gte: daysAgo };
    }

    const orders = await db.collection('orders')
      .find(query)
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .toArray();

    orderCache.set(cacheKey, orders);
    res.json({ success: true, orders, count: orders.length });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

// ==================== GET RECENT ORDERS (Admin/Cashier) ====================
router.get('/recent', requireAdminOrCashier, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const cached = orderCache.get('recent_orders');
    if (cached) {
      return res.json({ success: true, orders: cached, fromCache: true });
    }

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orders = await db.collection('orders')
      .find({ created_at: { $gte: last24h } })
      .sort({ created_at: -1 })
      .toArray();

    orderCache.set('recent_orders', orders);
    res.json({ success: true, orders });
  } catch (err) {
    console.error('Error fetching recent orders:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch recent orders' });
  }
});

// ==================== CREATE ORDER ====================
router.post('/', requireAdminOrCashier, [
  body('orderNumber').notEmpty().withMessage('Order number required'),
  body('customerName').notEmpty().withMessage('Customer name required'),
  body('customerEmail').isEmail().withMessage('Valid email required'),
  body('phone').notEmpty().withMessage('Phone required'),
  body('address').notEmpty().withMessage('Address required'),
  body('total').isNumeric().withMessage('Total must be a number'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const { orderNumber, customerName, customerEmail, phone, address, notes, subtotal, delivery, total, items, paymentMethod } = req.body;

    const order = {
      order_number: orderNumber,
      customer_name: customerName,
      customer_email: customerEmail.toLowerCase(),
      phone,
      address,
      notes: notes || '',
      subtotal: subtotal || 0,
      delivery: delivery || 0,
      total,
      payment_method: paymentMethod || 'M-PESA',
      status: 'pending',
      items: items.map(item => ({ product_name: item.name, ...item, size: item.size || '750ml' })),
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await db.collection('orders').insertOne(order);

    clearOrderCache();
    if (customerEmail) {
      const cacheKey = 'orders_' + customerEmail.toLowerCase();
      orderCache.del(cacheKey);
    }

    res.json({ success: true, order: { _id: result.insertedId, ...order } });
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
});

// ==================== PAY ON DELIVERY (POD) ====================
router.post('/pod', orderCreateLimiter, [
  body('customerName').notEmpty().withMessage('Name required'),
  body('customerEmail').isEmail().withMessage('Valid email required'),
  body('phone').notEmpty().withMessage('Phone required'),
  body('address').notEmpty().withMessage('Address required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item required'),
  body('total').isNumeric().withMessage('Total must be a number'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const {
      orderNumber,
      customerName,
      customerEmail,
      phone,
      address,
      notes,
      subtotal,
      delivery,
      total,
      items
    } = req.body;

    const finalOrderNumber = orderNumber && orderNumber.trim() !== ''
      ? orderNumber.trim()
      : 'POD-' + Date.now().toString(36).toUpperCase();

    const order = {
      order_number: finalOrderNumber,
      customer_name: customerName,
      customer_email: customerEmail.toLowerCase(),
      phone,
      address,
      notes: notes || '',
      subtotal: subtotal || 0,
      delivery: delivery || 0,
      total,
      payment_method: 'POD',
      status: 'pending',
      items: items.map(item => ({
        product_name: item.name || item.product_name,
        ...item,
        size: item.size || '750ml'
      })),
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await db.collection('orders').insertOne(order);

    await sendMpesaOrderReceivedEmail({
      orderId: finalOrderNumber,
      customerName,
      items: order.items,
      subtotal: order.subtotal,
      delivery: order.delivery,
      total: order.total,
      address,
      phone,
      customerEmail,
      paymentMethod: 'pod'
    });

    clearOrderCache();
    const cacheKey = 'orders_' + customerEmail.toLowerCase();
    orderCache.del(cacheKey);

    res.json({ success: true, order: { _id: result.insertedId, ...order } });
  } catch (err) {
    console.error('Error creating POD order:', err);
    res.status(500).json({ success: false, message: 'Failed to place order' });
  }
});

// ==================== UPDATE ORDER STATUS (Admin) ====================
router.put('/:id/status', requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'paid', 'delivered'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid order ID' });
    }

    const result = await db.collection('orders').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updated_at: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    clearOrderCache();

    if (status === 'delivered') {
      const order = await db.collection('orders').findOne({ _id: new ObjectId(id) });
      if (order && order.customer_email) {
        await sendOrderDeliveredEmail({
          orderId: order.order_number,
          customerName: order.customer_name,
          items: order.items,
          total: order.total,
          phone: order.phone,
          customerEmail: order.customer_email
        });
        const cacheKey = 'orders_' + order.customer_email.toLowerCase();
        orderCache.del(cacheKey);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
});

// ==================== UPDATE ORDER STATUS (Cashier) ====================
router.put('/cashier/:id/status', requireAdminOrCashier, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'paid', 'delivered'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid order ID' });
    }

    const result = await db.collection('orders').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updated_at: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    clearOrderCache();

    if (status === 'delivered') {
      const order = await db.collection('orders').findOne({ _id: new ObjectId(id) });
      if (order && order.customer_email) {
        await sendOrderDeliveredEmail({
          orderId: order.order_number,
          customerName: order.customer_name,
          items: order.items,
          total: order.total,
          phone: order.phone,
          customerEmail: order.customer_email
        });
        const cacheKey = 'orders_' + order.customer_email.toLowerCase();
        orderCache.del(cacheKey);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
});

// ==================== MARK POD ORDER AS PAID ====================
router.put('/:id/mark-paid', requireAdminOrCashier, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid order ID' });
    }

    const result = await db.collection('orders').updateOne(
      { _id: new ObjectId(id), payment_method: 'POD' },
      { $set: { status: 'paid', updated_at: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Order not found or not a POD order' });
    }

    clearOrderCache();
    res.json({ success: true, message: 'Order marked as paid' });
  } catch (err) {
    console.error('Error marking order paid:', err);
    res.status(500).json({ success: false, message: 'Failed to update order' });
  }
});

// ==================== DELETE ORDER ====================
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid order ID' });
    }

    const order = await db.collection('orders').findOne({ _id: new ObjectId(id) });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    await db.collection('orders').deleteOne({ _id: new ObjectId(id) });

    clearOrderCache();
    if (order && order.customer_email) {
      const cacheKey = 'orders_' + order.customer_email.toLowerCase();
      orderCache.del(cacheKey);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting order:', err);
    res.status(500).json({ success: false, message: 'Failed to delete order' });
  }
});

module.exports = router;
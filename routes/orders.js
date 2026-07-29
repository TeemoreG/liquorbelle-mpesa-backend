const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { requireAdmin, requireAdminOrCashier, requireCustomer } = require('../middleware/auth');
const { orderCache, clearOrderCache } = require('../utils/cache');
const { sendMpesaOrderReceivedEmail, sendOrderDeliveredEmail } = require('../utils/email');
const { orderCreateLimiter } = require('../config/rateLimits');
const { isValidEmail, DEFAULT_DELIVERY } = require('../config/constants');

const router = express.Router();

// ==================== HELPER: Validate Phone ====================
function isValidPhone(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length === 10 && (cleaned.startsWith('07') || cleaned.startsWith('01'));
}

function formatPhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10 && (cleaned.startsWith('07') || cleaned.startsWith('01'))) {
    return '254' + cleaned.slice(1);
  }
  return cleaned;
}

// ==================== HELPER: Calculate Delivery Fee ====================
async function calculateDeliveryFee(area, subtotal) {
  try {
    const db = getDB();
    if (!db) {
      return DEFAULT_DELIVERY.fee;
    }

    const settings = await db.collection('settings').findOne({ key: 'delivery' });
    const defaultFee = settings?.value?.default_fee || DEFAULT_DELIVERY.fee;
    const freeThreshold = settings?.value?.free_threshold || DEFAULT_DELIVERY.freeThreshold;
    const enabled = settings?.value?.enabled !== false;

    if (!enabled) {
      return 0;
    }

    if (subtotal && subtotal >= freeThreshold) {
      return 0;
    }

    if (!area) {
      return defaultFee;
    }

    const zone = await db.collection('delivery_zones').findOne({
      name: { $regex: new RegExp('^' + area.trim() + '$', 'i') }
    });

    return zone?.fee || defaultFee;
  } catch (err) {
    console.error('Error calculating delivery fee:', err);
    return DEFAULT_DELIVERY.fee;
  }
}

// ==================== GET ALL ORDERS (Admin) ====================
router.get('/', requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

    const cached = orderCache.get('all_orders');
    if (cached) {
      return res.json({ 
        success: true, 
        orders: cached, 
        count: cached.length,
        fromCache: true 
      });
    }

    const orders = await db.collection('orders')
      .find({})
      .sort({ created_at: -1 })
      .toArray();

    orderCache.set('all_orders', orders);
    res.json({ 
      success: true, 
      orders, 
      count: orders.length 
    });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch orders' 
    });
  }
});

// ==================== GET ALL ORDERS (Admin/Cashier with filters) ====================
router.get('/all', requireAdminOrCashier, [
  query('limit').optional().isInt({ min: 1, max: 5000 }).withMessage('Limit must be between 1 and 5000'),
  query('status').optional().isIn(['pending', 'paid', 'delivered', 'all']).withMessage('Invalid status'),
  query('days').optional().isInt({ min: 1, max: 365 }).withMessage('Days must be between 1 and 365'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be at least 1')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

    const { 
      limit = 100, 
      status, 
      days, 
      page = 1,
      search,
      paymentMethod
    } = req.query;

    const skip = (page - 1) * parseInt(limit);

    const cacheKey = `orders_${status || 'all'}_${days || 'all'}_${search || 'none'}_${paymentMethod || 'all'}_page${page}`;
    const cached = orderCache.get(cacheKey);
    if (cached) {
      return res.json({ 
        success: true, 
        ...cached, 
        fromCache: true 
      });
    }

    let query = {};
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    if (days && days !== 'all') {
      const daysAgo = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);
      query.created_at = { $gte: daysAgo };
    }

    if (paymentMethod && paymentMethod !== 'all') {
      query.payment_method = paymentMethod;
    }

    if (search) {
      query.$or = [
        { customer_name: { $regex: search, $options: 'i' } },
        { customer_email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { order_number: { $regex: search, $options: 'i' } }
      ];
    }

    const [orders, total] = await Promise.all([
      db.collection('orders')
        .find(query)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray(),
      db.collection('orders').countDocuments(query)
    ]);

    const result = {
      orders,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
      hasNext: page * parseInt(limit) < total,
      hasPrev: parseInt(page) > 1
    };

    orderCache.set(cacheKey, result);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch orders' 
    });
  }
});

// ==================== GET RECENT ORDERS (Admin/Cashier) ====================
router.get('/recent', requireAdminOrCashier, [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

    const limit = parseInt(req.query.limit) || 20;

    const cached = orderCache.get('recent_orders');
    if (cached) {
      return res.json({ 
        success: true, 
        orders: cached, 
        count: cached.length,
        fromCache: true 
      });
    }

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orders = await db.collection('orders')
      .find({ created_at: { $gte: last24h } })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();

    orderCache.set('recent_orders', orders);
    res.json({ 
      success: true, 
      orders, 
      count: orders.length 
    });
  } catch (err) {
    console.error('Error fetching recent orders:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch recent orders' 
    });
  }
});

// ==================== GET ORDER BY ID ====================
router.get('/:id', requireAdminOrCashier, [
  param('id').custom(value => ObjectId.isValid(value)).withMessage('Invalid order ID')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

    const { id } = req.params;

    const cacheKey = `order_${id}`;
    const cached = orderCache.get(cacheKey);
    if (cached) {
      return res.json({ 
        success: true, 
        order: cached, 
        fromCache: true 
      });
    }

    const order = await db.collection('orders').findOne({ 
      _id: new ObjectId(id) 
    });

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    orderCache.set(cacheKey, order);
    res.json({ success: true, order });
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch order' 
    });
  }
});

// ==================== GET ORDER BY ORDER NUMBER (Public) ====================
router.get('/number/:orderNumber', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

    const { orderNumber } = req.params;

    const order = await db.collection('orders').findOne({ 
      order_number: orderNumber 
    });

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    res.json({ success: true, order });
  } catch (err) {
    console.error('Error fetching order by number:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch order' 
    });
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
  body('items').isArray({ min: 1 }).withMessage('At least one item required'),
  body('deliveryArea').optional().isString().withMessage('Delivery area must be a string')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

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
      items, 
      paymentMethod,
      deliveryArea
    } = req.body;

    const existing = await db.collection('orders').findOne({ 
      order_number: orderNumber 
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Order number already exists'
      });
    }

    let finalDelivery = delivery;
    if (finalDelivery === undefined || finalDelivery === null) {
      finalDelivery = await calculateDeliveryFee(deliveryArea, subtotal || 0);
    }

    const order = {
      order_number: orderNumber,
      customer_name: customerName,
      customer_email: customerEmail.toLowerCase(),
      phone,
      address,
      notes: notes || '',
      subtotal: subtotal || 0,
      delivery: finalDelivery,
      total: (subtotal || 0) + finalDelivery,
      payment_method: paymentMethod || 'M-PESA',
      status: 'pending',
      delivery_area: deliveryArea || '',
      items: items.map(item => ({ 
        product_name: item.name || item.product_name, 
        ...item, 
        size: item.size || '750ml' 
      })),
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await db.collection('orders').insertOne(order);

    clearOrderCache();
    if (customerEmail) {
      orderCache.del('orders_' + customerEmail.toLowerCase());
    }

    res.json({ 
      success: true, 
      message: 'Order created successfully',
      order: { _id: result.insertedId, ...order } 
    });
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create order' 
    });
  }
});

// ==================== PAY ON DELIVERY (POD) - FIXED WITH EMAIL ====================
router.post('/pod', orderCreateLimiter, [
  body('customerName').notEmpty().withMessage('Name required'),
  body('customerEmail').isEmail().withMessage('Valid email required'),
  body('phone').notEmpty().withMessage('Phone required'),
  body('address').notEmpty().withMessage('Address required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item required'),
  body('total').isNumeric().withMessage('Total must be a number'),
  body('customerName').optional().isString().isLength({ min: 2, max: 100 }),
  body('deliveryArea').optional().isString().withMessage('Delivery area must be a string')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

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
      items,
      deliveryArea
    } = req.body;

    const finalOrderNumber = orderNumber && orderNumber.trim() !== ''
      ? orderNumber.trim()
      : 'POD-' + Date.now().toString(36).toUpperCase();

    const existing = await db.collection('orders').findOne({ 
      order_number: finalOrderNumber 
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Order number already exists. Please try again.'
      });
    }

    let finalDelivery = delivery;
    if (finalDelivery === undefined || finalDelivery === null) {
      finalDelivery = await calculateDeliveryFee(deliveryArea, subtotal || 0);
    }

    const order = {
      order_number: finalOrderNumber,
      customer_name: customerName,
      customer_email: customerEmail.toLowerCase(),
      phone,
      address,
      notes: notes || '',
      subtotal: subtotal || 0,
      delivery: finalDelivery,
      total: (subtotal || 0) + finalDelivery,
      payment_method: 'POD',
      status: 'pending',
      delivery_area: deliveryArea || '',
      items: items.map(item => ({
        product_name: item.name || item.product_name,
        ...item,
        size: item.size || '750ml'
      })),
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await db.collection('orders').insertOne(order);

    // ============================================================
    // 🔥 SEND EMAIL FOR POD ORDER (FIXED - NOW WORKS)
    // ============================================================
    try {
      console.log(`📧 Sending POD email to ${customerEmail} for order ${finalOrderNumber}`);
      await sendMpesaOrderReceivedEmail({
        orderId: finalOrderNumber,
        customerName: customerName,
        customerEmail: customerEmail.toLowerCase(),
        items: order.items,
        subtotal: order.subtotal,
        delivery: order.delivery,
        total: order.total,
        address: address,
        phone: phone,
        paymentMethod: 'pod'
      });
      console.log(`✅ POD email sent successfully to ${customerEmail}`);
    } catch (emailError) {
      console.error('❌ POD email error (non-blocking):', emailError.message);
      // Don't fail the order if email fails
    }

    clearOrderCache();
    orderCache.del('orders_' + customerEmail.toLowerCase());

    res.json({ 
      success: true, 
      message: 'Order placed successfully! Check your email for confirmation.',
      order: { _id: result.insertedId, ...order } 
    });
  } catch (err) {
    console.error('Error creating POD order:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to place order: ' + err.message 
    });
  }
});

// ==================== GET ORDERS FOR AUTHENTICATED CUSTOMER (Frontend uses this) ====================
router.get('/me/orders', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

    const customerId = req.customer?.userId || req.user?.userId;
    
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(customerId)
    });

    if (!customer) {
      return res.status(404).json({ 
        success: false, 
        message: 'Customer not found' 
      });
    }

    if (customer.deleted === true) {
      return res.status(403).json({
        success: false,
        message: 'Account has been deactivated'
      });
    }

    const orders = await db.collection('orders')
      .find({
        $or: [
          { customer_email: customer.email },
          { phone: customer.phone }
        ]
      })
      .sort({ created_at: -1 })
      .toArray();

    console.log(`📋 Found ${orders.length} orders for ${customer.email}`);

    res.json({ 
      success: true, 
      orders, 
      count: orders.length 
    });
  } catch (err) {
    console.error('Error fetching customer orders:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch orders: ' + err.message 
    });
  }
});

// ==================== GET ORDERS BY CUSTOMER (Admin) ====================
router.get('/customer/:id', requireAdmin, [
  param('id').custom(value => ObjectId.isValid(value)).withMessage('Invalid customer ID')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

    const { id } = req.params;

    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(id)
    });

    if (!customer) {
      return res.status(404).json({ 
        success: false, 
        message: 'Customer not found' 
      });
    }

    const orders = await db.collection('orders')
      .find({
        $or: [
          { customer_email: customer.email },
          { phone: customer.phone }
        ]
      })
      .sort({ created_at: -1 })
      .toArray();

    res.json({ 
      success: true, 
      orders, 
      count: orders.length 
    });
  } catch (err) {
    console.error('Error fetching customer orders:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch orders' 
    });
  }
});

// ==================== UPDATE ORDER STATUS (Admin) ====================
router.put('/:id/status', requireAdmin, [
  param('id').custom(value => ObjectId.isValid(value)).withMessage('Invalid order ID'),
  body('status').isIn(['pending', 'paid', 'delivered']).withMessage('Invalid status')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

    const { id } = req.params;
    const { status } = req.body;

    const result = await db.collection('orders').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updated_at: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    clearOrderCache();
    orderCache.del('order_' + id);

    const order = await db.collection('orders').findOne({ _id: new ObjectId(id) });
    if (order && order.customer_email) {
      orderCache.del('orders_' + order.customer_email.toLowerCase());

      if (status === 'delivered') {
        try {
          await sendOrderDeliveredEmail({
            orderId: order.order_number,
            customerName: order.customer_name,
            customerEmail: order.customer_email,
            items: order.items,
            subtotal: order.subtotal,
            delivery: order.delivery,
            total: order.total,
            phone: order.phone
          });
          console.log(`✅ Delivery email sent for order ${order.order_number}`);
        } catch (emailError) {
          console.error('❌ Delivery email error:', emailError);
        }
      }
    }

    res.json({ 
      success: true, 
      message: `Order status updated to ${status}` 
    });
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update order status' 
    });
  }
});

// ==================== UPDATE ORDER STATUS (Cashier) ====================
router.put('/cashier/:id/status', requireAdminOrCashier, [
  param('id').custom(value => ObjectId.isValid(value)).withMessage('Invalid order ID'),
  body('status').isIn(['pending', 'paid', 'delivered']).withMessage('Invalid status')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

    const { id } = req.params;
    const { status } = req.body;

    const result = await db.collection('orders').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updated_at: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    clearOrderCache();
    orderCache.del('order_' + id);

    const order = await db.collection('orders').findOne({ _id: new ObjectId(id) });
    if (order && order.customer_email) {
      orderCache.del('orders_' + order.customer_email.toLowerCase());

      if (status === 'delivered') {
        try {
          await sendOrderDeliveredEmail({
            orderId: order.order_number,
            customerName: order.customer_name,
            customerEmail: order.customer_email,
            items: order.items,
            subtotal: order.subtotal,
            delivery: order.delivery,
            total: order.total,
            phone: order.phone
          });
          console.log(`✅ Delivery email sent for order ${order.order_number}`);
        } catch (emailError) {
          console.error('❌ Delivery email error:', emailError);
        }
      }
    }

    res.json({ 
      success: true, 
      message: `Order status updated to ${status}` 
    });
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update order status' 
    });
  }
});

// ==================== MARK POD ORDER AS PAID ====================
router.put('/:id/mark-paid', requireAdminOrCashier, [
  param('id').custom(value => ObjectId.isValid(value)).withMessage('Invalid order ID')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

    const { id } = req.params;

    const result = await db.collection('orders').updateOne(
      { _id: new ObjectId(id), payment_method: 'POD' },
      { $set: { status: 'paid', updated_at: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found or not a POD order' 
      });
    }

    clearOrderCache();
    orderCache.del('order_' + id);

    res.json({ 
      success: true, 
      message: 'Order marked as paid' 
    });
  } catch (err) {
    console.error('Error marking order paid:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update order' 
    });
  }
});

// ==================== DELETE ORDER ====================
router.delete('/:id', requireAdmin, [
  param('id').custom(value => ObjectId.isValid(value)).withMessage('Invalid order ID')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

    const { id } = req.params;

    const order = await db.collection('orders').findOne({ _id: new ObjectId(id) });

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    if (order.status === 'delivered') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete delivered orders'
      });
    }

    await db.collection('orders').deleteOne({ _id: new ObjectId(id) });

    clearOrderCache();
    if (order.customer_email) {
      orderCache.del('orders_' + order.customer_email.toLowerCase());
    }
    orderCache.del('order_' + id);

    res.json({ 
      success: true, 
      message: 'Order deleted successfully' 
    });
  } catch (err) {
    console.error('Error deleting order:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete order' 
    });
  }
});

// ==================== GET DELIVERY FEE FOR AREA (Public) ====================
router.post('/delivery-fee', [
  body('area').notEmpty().withMessage('Area is required'),
  body('subtotal').optional().isNumeric().withMessage('Subtotal must be a number')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    const { area, subtotal = 0 } = req.body;
    const fee = await calculateDeliveryFee(area, subtotal);
    
    res.json({
      success: true,
      fee: fee,
      isFree: fee === 0 && subtotal > 0
    });
  } catch (err) {
    console.error('Error getting delivery fee:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate delivery fee'
    });
  }
});

module.exports = router;
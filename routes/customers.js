const express = require('express');
const { body, validationResult } = require('express-validator');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { requireCustomer } = require('../middleware/auth');
const { isValidEmail } = require('../config/constants');
const bcrypt = require('bcryptjs');

const router = express.Router();

// Validate phone
function isValidPhone(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length >= 10 && cleaned.length <= 15 &&
         (cleaned.startsWith('07') || cleaned.startsWith('01') || cleaned.startsWith('254'));
}

function formatPhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10 && (cleaned.startsWith('07') || cleaned.startsWith('01'))) {
    return '254' + cleaned.slice(1);
  }
  if (cleaned.length === 12 && cleaned.startsWith('254')) {
    return cleaned;
  }
  return cleaned;
}

// GET current customer profile
router.get('/me', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(req.customer.userId)
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.deleted === true) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    res.json({
      success: true,
      customer: {
        id: customer._id,
        name: customer.name,
        email: customer.email || '',
        phone: customer.phone || '',
        address: customer.address || '',
        favorites: customer.favorites || [],
        orderHistory: customer.orderHistory || [],
        googleId: customer.googleId || null,
        authMethod: customer.googleId ? 'google' : 'email',
        createdAt: customer.createdAt || customer.created_at,
        updatedAt: customer.updatedAt || customer.updated_at,
        hasPin: !!customer.pin
      }
    });
  } catch (err) {
    console.error('Error fetching current customer:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch customer profile' });
  }
});

// GET customer by phone
router.get('/phone/:phone', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const { phone } = req.params;

    if (!isValidPhone(phone)) {
      return res.status(400).json({ success: false, message: 'Invalid phone number format. Use 07XXXXXXXX or 01XXXXXXXX' });
    }

    const formattedPhone = formatPhone(phone);
    const customer = await db.collection('customers').findOne({ phone: formattedPhone });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.deleted === true) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    res.json({
      success: true,
      customer: {
        id: customer._id,
        name: customer.name,
        email: customer.email || '',
        phone: customer.phone,
        address: customer.address || '',
        googleId: customer.googleId || null,
        createdAt: customer.createdAt || customer.created_at
      }
    });
  } catch (err) {
    console.error('Error fetching customer by phone:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch customer' });
  }
});

// GET customer by email
router.get('/email/:email', async (req, res) => {
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

    if (customer.deleted === true) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    res.json({
      success: true,
      customer: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone || '',
        address: customer.address || '',
        googleId: customer.googleId || null,
        createdAt: customer.createdAt || customer.created_at
      }
    });
  } catch (err) {
    console.error('Error fetching customer by email:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch customer' });
  }
});

// UPDATE current customer profile
router.put('/me', requireCustomer, [
  body('name').optional().isString().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('phone').optional().custom(value => isValidPhone(value)).withMessage('Invalid phone number format. Use 07XXXXXXXX or 01XXXXXXXX'),
  body('email').optional().isEmail().withMessage('Valid email required'),
  body('address').optional().isString().isLength({ max: 500 }).withMessage('Address must be less than 500 characters')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const { name, phone, email, address } = req.body;
    const customerId = req.customer.userId;

    const existingCustomer = await db.collection('customers').findOne({ _id: new ObjectId(customerId) });

    if (!existingCustomer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (existingCustomer.deleted === true) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    const updateData = { updatedAt: new Date() };

    if (name) updateData.name = name;
    if (phone) updateData.phone = formatPhone(phone);
    if (email) updateData.email = email.toLowerCase();
    if (address !== undefined) updateData.address = address;

    if (email) {
      const existing = await db.collection('customers').findOne({
        email: email.toLowerCase(),
        _id: { $ne: new ObjectId(customerId) }
      });
      if (existing) {
        return res.status(409).json({ success: false, message: 'Email already in use by another account' });
      }
    }

    if (phone) {
      const formattedPhone = formatPhone(phone);
      const existing = await db.collection('customers').findOne({
        phone: formattedPhone,
        _id: { $ne: new ObjectId(customerId) }
      });
      if (existing) {
        return res.status(409).json({ success: false, message: 'Phone number already in use by another account' });
      }
    }

    const result = await db.collection('customers').updateOne(
      { _id: new ObjectId(customerId) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const updatedCustomer = await db.collection('customers').findOne({ _id: new ObjectId(customerId) });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      customer: {
        id: updatedCustomer._id,
        name: updatedCustomer.name,
        email: updatedCustomer.email || '',
        phone: updatedCustomer.phone || '',
        address: updatedCustomer.address || '',
        updatedAt: updatedCustomer.updatedAt
      }
    });
  } catch (err) {
    console.error('Error updating customer:', err);
    res.status(500).json({ success: false, message: 'Failed to update customer profile' });
  }
});

// UPDATE PIN
router.put('/me/pin', requireCustomer, [
  body('currentPin').notEmpty().withMessage('Current PIN required')
    .isLength({ min: 4, max: 4 }).withMessage('PIN must be exactly 4 digits')
    .isNumeric().withMessage('PIN must be numeric'),
  body('newPin').notEmpty().withMessage('New PIN required')
    .isLength({ min: 4, max: 4 }).withMessage('PIN must be exactly 4 digits')
    .isNumeric().withMessage('PIN must be numeric')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const customerId = req.customer.userId;
    const { currentPin, newPin } = req.body;

    const customer = await db.collection('customers').findOne({ _id: new ObjectId(customerId) });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.deleted === true) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    if (!customer.pin) {
      return res.status(400).json({ success: false, message: 'Account has no PIN set. Please set one first.' });
    }

    const isMatch = await bcrypt.compare(currentPin, customer.pin);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current PIN is incorrect' });
    }

    const hashedPin = await bcrypt.hash(newPin, 10);

    await db.collection('customers').updateOne(
      { _id: new ObjectId(customerId) },
      { $set: { pin: hashedPin, updatedAt: new Date() } }
    );

    res.json({ success: true, message: 'PIN updated successfully' });
  } catch (err) {
    console.error('Update PIN error:', err);
    res.status(500).json({ success: false, message: 'Failed to update PIN' });
  }
});

// SET PIN (first time)
router.put('/me/set-pin', requireCustomer, [
  body('pin').notEmpty().withMessage('PIN required')
    .isLength({ min: 4, max: 4 }).withMessage('PIN must be exactly 4 digits')
    .isNumeric().withMessage('PIN must be numeric')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const customerId = req.customer.userId;
    const { pin } = req.body;

    const customer = await db.collection('customers').findOne({ _id: new ObjectId(customerId) });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.deleted === true) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    if (customer.pin) {
      return res.status(400).json({ success: false, message: 'PIN already set. Use update PIN endpoint to change.' });
    }

    const hashedPin = await bcrypt.hash(pin, 10);

    await db.collection('customers').updateOne(
      { _id: new ObjectId(customerId) },
      { $set: { pin: hashedPin, updatedAt: new Date() } }
    );

    res.json({ success: true, message: 'PIN set successfully' });
  } catch (err) {
    console.error('Set PIN error:', err);
    res.status(500).json({ success: false, message: 'Failed to set PIN' });
  }
});

// TOGGLE FAVORITE
router.put('/me/favorites', requireCustomer, [
  body('productId').notEmpty().withMessage('Product ID required')
    .custom(value => ObjectId.isValid(value)).withMessage('Invalid product ID')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const { productId } = req.body;
    const customerId = req.customer.userId;

    const customer = await db.collection('customers').findOne({ _id: new ObjectId(customerId) });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.deleted === true) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    const favorites = customer.favorites || [];
    const index = favorites.indexOf(productId);

    if (index > -1) {
      favorites.splice(index, 1);
    } else {
      favorites.push(productId);
    }

    await db.collection('customers').updateOne(
      { _id: new ObjectId(customerId) },
      { $set: { favorites, updatedAt: new Date() } }
    );

    res.json({
      success: true,
      message: index > -1 ? 'Removed from favorites' : 'Added to favorites',
      favorites,
      isFavorite: index === -1
    });
  } catch (err) {
    console.error('Error updating favorites:', err);
    res.status(500).json({ success: false, message: 'Failed to update favorites' });
  }
});

// GET FAVORITES
router.get('/me/favorites', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const customerId = req.customer.userId;

    const customer = await db.collection('customers').findOne({ _id: new ObjectId(customerId) });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.deleted === true) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    const favorites = customer.favorites || [];

    const products = [];
    if (favorites.length > 0) {
      const productIds = favorites.map(id => {
        try { return new ObjectId(id); } catch { return null; }
      }).filter(id => id !== null);

      if (productIds.length > 0) {
        const productDocs = await db.collection('products').find({ _id: { $in: productIds } }).toArray();
        products.push(...productDocs);
      }
    }

    res.json({ success: true, favorites, products, count: products.length });
  } catch (err) {
    console.error('Error fetching favorites:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch favorites' });
  }
});

// GET customer orders
router.get('/me/orders', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const customerId = req.customer.userId;

    const customer = await db.collection('customers').findOne({ _id: new ObjectId(customerId) });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.deleted === true) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
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

    res.json({ success: true, orders, count: orders.length });
  } catch (err) {
    console.error('Error fetching customer orders:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

// GET single order
router.get('/me/orders/:orderId', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const { orderId } = req.params;
    const customerId = req.customer.userId;

    const customer = await db.collection('customers').findOne({ _id: new ObjectId(customerId) });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.deleted === true) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    const order = await db.collection('orders').findOne({
      order_number: orderId,
      $or: [
        { customer_email: customer.email },
        { phone: customer.phone }
      ]
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    res.json({ success: true, order });
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
});

// DELETE customer account (soft delete)
router.delete('/me', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const customerId = req.customer.userId;

    const customer = await db.collection('customers').findOne({ _id: new ObjectId(customerId) });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.deleted === true) {
      return res.status(400).json({ success: false, message: 'Account already deactivated' });
    }

    const pendingOrders = await db.collection('orders').countDocuments({
      $or: [
        { customer_email: customer.email },
        { phone: customer.phone }
      ],
      status: { $in: ['pending', 'paid'] }
    });

    if (pendingOrders > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete account with ${pendingOrders} pending order(s). Please complete or cancel them first.`
      });
    }

    await db.collection('customers').updateOne(
      { _id: new ObjectId(customerId) },
      { $set: { deleted: true, deletedAt: new Date(), updatedAt: new Date() } }
    );

    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (err) {
    console.error('Error deleting customer:', err);
    res.status(500).json({ success: false, message: 'Failed to delete account' });
  }
});

// GET all addresses
router.get('/me/addresses', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const customerId = req.customer.userId;

    const customer = await db.collection('customers').findOne({ _id: new ObjectId(customerId) });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.deleted === true) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    res.json({ success: true, addresses: customer.addresses || [] });
  } catch (err) {
    console.error('Error fetching addresses:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch addresses' });
  }
});

// POST new address
router.post('/me/addresses', requireCustomer, [
  body('label').optional().isString(),
  body('line1').notEmpty().withMessage('Address line is required'),
  body('area').optional().isString(),
  body('landmark').optional().isString(),
  body('phone').optional().isString(),
  body('isDefault').optional().isBoolean()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const customerId = req.customer.userId;
    const { label, line1, area, landmark, phone, isDefault } = req.body;

    const customer = await db.collection('customers').findOne({ _id: new ObjectId(customerId) });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.deleted === true) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    const addresses = customer.addresses || [];
    const newAddress = {
      id: 'addr_' + Date.now(),
      label: label || 'Home',
      line1,
      area: area || '',
      landmark: landmark || '',
      phone: phone || '',
      isDefault: isDefault || false,
      createdAt: new Date()
    };

    if (newAddress.isDefault) {
      addresses.forEach(a => a.isDefault = false);
    }

    addresses.push(newAddress);

    await db.collection('customers').updateOne(
      { _id: new ObjectId(customerId) },
      { $set: { addresses, updatedAt: new Date() } }
    );

    res.json({ success: true, message: 'Address added successfully', address: newAddress, addresses });
  } catch (err) {
    console.error('Error adding address:', err);
    res.status(500).json({ success: false, message: 'Failed to add address' });
  }
});

// PUT update address
router.put('/me/addresses/:addressId', requireCustomer, [
  body('label').optional().isString(),
  body('line1').optional().isString(),
  body('area').optional().isString(),
  body('landmark').optional().isString(),
  body('phone').optional().isString(),
  body('isDefault').optional().isBoolean()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const customerId = req.customer.userId;
    const { addressId } = req.params;
    const { label, line1, area, landmark, phone, isDefault } = req.body;

    const customer = await db.collection('customers').findOne({ _id: new ObjectId(customerId) });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.deleted === true) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    const addresses = customer.addresses || [];
    const addressIndex = addresses.findIndex(a => a.id === addressId);

    if (addressIndex === -1) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    if (label) addresses[addressIndex].label = label;
    if (line1) addresses[addressIndex].line1 = line1;
    if (area) addresses[addressIndex].area = area;
    if (landmark) addresses[addressIndex].landmark = landmark;
    if (phone) addresses[addressIndex].phone = phone;
    if (isDefault !== undefined) addresses[addressIndex].isDefault = isDefault;

    if (addresses[addressIndex].isDefault) {
      addresses.forEach((a, index) => {
        if (index !== addressIndex) a.isDefault = false;
      });
    }

    addresses[addressIndex].updatedAt = new Date();

    await db.collection('customers').updateOne(
      { _id: new ObjectId(customerId) },
      { $set: { addresses, updatedAt: new Date() } }
    );

    res.json({ success: true, message: 'Address updated successfully', address: addresses[addressIndex], addresses });
  } catch (err) {
    console.error('Error updating address:', err);
    res.status(500).json({ success: false, message: 'Failed to update address' });
  }
});

// DELETE address
router.delete('/me/addresses/:addressId', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const customerId = req.customer.userId;
    const { addressId } = req.params;

    const customer = await db.collection('customers').findOne({ _id: new ObjectId(customerId) });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.deleted === true) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    const addresses = customer.addresses || [];
    const newAddresses = addresses.filter(a => a.id !== addressId);

    if (newAddresses.length === addresses.length) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    await db.collection('customers').updateOne(
      { _id: new ObjectId(customerId) },
      { $set: { addresses: newAddresses, updatedAt: new Date() } }
    );

    res.json({ success: true, message: 'Address deleted successfully', addresses: newAddresses });
  } catch (err) {
    console.error('Error deleting address:', err);
    res.status(500).json({ success: false, message: 'Failed to delete address' });
  }
});

// PUT set default address
router.put('/me/addresses/:addressId/default', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const customerId = req.customer.userId;
    const { addressId } = req.params;

    const customer = await db.collection('customers').findOne({ _id: new ObjectId(customerId) });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.deleted === true) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    const addresses = customer.addresses || [];
    const addressIndex = addresses.findIndex(a => a.id === addressId);

    if (addressIndex === -1) {
      return res.status(404).json({ success: false, message: 'Address not found' });
    }

    addresses.forEach(a => a.isDefault = false);
    addresses[addressIndex].isDefault = true;

    await db.collection('customers').updateOne(
      { _id: new ObjectId(customerId) },
      { $set: { addresses, updatedAt: new Date() } }
    );

    res.json({ success: true, message: 'Default address updated', addresses });
  } catch (err) {
    console.error('Error setting default address:', err);
    res.status(500).json({ success: false, message: 'Failed to set default address' });
  }
});

module.exports = router;
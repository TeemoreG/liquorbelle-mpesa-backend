const express = require('express');
const { body, validationResult } = require('express-validator');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { requireCustomer } = require('../middleware/auth');
const { isValidEmail } = require('../config/constants');
const bcrypt = require('bcryptjs');

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

// ==================== GET CURRENT CUSTOMER PROFILE ====================
router.get('/me', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({
        success: false,
        message: 'Database connecting...'
      });
    }

    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(req.customer.userId)
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
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
        createdAt: customer.createdAt || customer.created_at,
        updatedAt: customer.updatedAt || customer.updated_at
      }
    });
  } catch (err) {
    console.error('Error fetching current customer:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer profile'
    });
  }
});

// ==================== GET CUSTOMER BY PHONE ====================
router.get('/phone/:phone', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({
        success: false,
        message: 'Database connecting...'
      });
    }

    const { phone } = req.params;

    if (!isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Use 07XXXXXXXX or 01XXXXXXXX'
      });
    }

    const formattedPhone = formatPhone(phone);
    const customer = await db.collection('customers').findOne({
      phone: formattedPhone
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    res.json({
      success: true,
      customer: {
        id: customer._id,
        name: customer.name,
        email: customer.email || '',
        phone: customer.phone,
        address: customer.address || '',
        createdAt: customer.createdAt || customer.created_at
      }
    });
  } catch (err) {
    console.error('Error fetching customer by phone:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer'
    });
  }
});

// ==================== GET CUSTOMER BY EMAIL ====================
router.get('/email/:email', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({
        success: false,
        message: 'Database connecting...'
      });
    }

    const { email } = req.params;

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    const customer = await db.collection('customers').findOne({
      email: email.toLowerCase()
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    res.json({
      success: true,
      customer: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone || '',
        address: customer.address || '',
        createdAt: customer.createdAt || customer.created_at
      }
    });
  } catch (err) {
    console.error('Error fetching customer by email:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer'
    });
  }
});

// ==================== UPDATE CURRENT CUSTOMER PROFILE ====================
router.put('/me', requireCustomer, [
  body('name').optional().isString().isLength({ min: 2, max: 100 })
    .withMessage('Name must be 2-100 characters'),
  body('phone').optional()
    .custom(value => isValidPhone(value))
    .withMessage('Invalid phone number format. Use 07XXXXXXXX or 01XXXXXXXX'),
  body('email').optional().isEmail().withMessage('Valid email required'),
  body('address').optional().isString().isLength({ max: 500 })
    .withMessage('Address must be less than 500 characters')
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

    const { name, phone, email, address } = req.body;
    const customerId = req.customer.userId;

    const updateData = {
      updatedAt: new Date()
    };

    if (name) updateData.name = name;
    if (phone) updateData.phone = formatPhone(phone);
    if (email) updateData.email = email.toLowerCase();
    if (address !== undefined) updateData.address = address;

    // Check if email is already taken by another customer
    if (email) {
      const existing = await db.collection('customers').findOne({
        email: email.toLowerCase(),
        _id: { $ne: new ObjectId(customerId) }
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'Email already in use by another account'
        });
      }
    }

    // Check if phone is already taken by another customer
    if (phone) {
      const formattedPhone = formatPhone(phone);
      const existing = await db.collection('customers').findOne({
        phone: formattedPhone,
        _id: { $ne: new ObjectId(customerId) }
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'Phone number already in use by another account'
        });
      }
    }

    const result = await db.collection('customers').updateOne(
      { _id: new ObjectId(customerId) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Fetch updated customer
    const updatedCustomer = await db.collection('customers').findOne({
      _id: new ObjectId(customerId)
    });

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
    res.status(500).json({
      success: false,
      message: 'Failed to update customer profile'
    });
  }
});

// ==================== UPDATE PIN ====================
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

    const customerId = req.customer.userId;
    const { currentPin, newPin } = req.body;

    // Get customer
    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(customerId)
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Check if customer has a PIN
    if (!customer.pin) {
      return res.status(400).json({
        success: false,
        message: 'Account has no PIN set. Please set one first.'
      });
    }

    // Verify current PIN
    const isMatch = await bcrypt.compare(currentPin, customer.pin);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current PIN is incorrect'
      });
    }

    // Hash new PIN
    const hashedPin = await bcrypt.hash(newPin, 10);

    await db.collection('customers').updateOne(
      { _id: new ObjectId(customerId) },
      { $set: { pin: hashedPin, updatedAt: new Date() } }
    );

    res.json({
      success: true,
      message: 'PIN updated successfully'
    });

  } catch (err) {
    console.error('Update PIN error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update PIN'
    });
  }
});

// ==================== SET PIN (First Time) ====================
router.put('/me/set-pin', requireCustomer, [
  body('pin').notEmpty().withMessage('PIN required')
    .isLength({ min: 4, max: 4 }).withMessage('PIN must be exactly 4 digits')
    .isNumeric().withMessage('PIN must be numeric')
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

    const customerId = req.customer.userId;
    const { pin } = req.body;

    // Get customer
    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(customerId)
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Check if PIN already set
    if (customer.pin) {
      return res.status(400).json({
        success: false,
        message: 'PIN already set. Use update PIN endpoint to change.'
      });
    }

    // Hash PIN
    const hashedPin = await bcrypt.hash(pin, 10);

    await db.collection('customers').updateOne(
      { _id: new ObjectId(customerId) },
      { $set: { pin: hashedPin, updatedAt: new Date() } }
    );

    res.json({
      success: true,
      message: 'PIN set successfully'
    });

  } catch (err) {
    console.error('Set PIN error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to set PIN'
    });
  }
});

// ==================== TOGGLE FAVORITE ====================
router.put('/me/favorites', requireCustomer, [
  body('productId').notEmpty().withMessage('Product ID required')
    .custom(value => ObjectId.isValid(value)).withMessage('Invalid product ID')
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

    const { productId } = req.body;
    const customerId = req.customer.userId;

    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(customerId)
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
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
    res.status(500).json({
      success: false,
      message: 'Failed to update favorites'
    });
  }
});

// ==================== GET FAVORITES ====================
router.get('/me/favorites', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({
        success: false,
        message: 'Database connecting...'
      });
    }

    const customerId = req.customer.userId;

    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(customerId)
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const favorites = customer.favorites || [];

    // Fetch product details for each favorite
    const products = [];
    if (favorites.length > 0) {
      const productIds = favorites.map(id => {
        try {
          return new ObjectId(id);
        } catch {
          return null;
        }
      }).filter(id => id !== null);

      if (productIds.length > 0) {
        const productDocs = await db.collection('products')
          .find({ _id: { $in: productIds } })
          .toArray();

        products.push(...productDocs);
      }
    }

    res.json({
      success: true,
      favorites,
      products,
      count: products.length
    });
  } catch (err) {
    console.error('Error fetching favorites:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch favorites'
    });
  }
});

// ==================== GET CUSTOMER ORDERS ====================
router.get('/me/orders', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({
        success: false,
        message: 'Database connecting...'
      });
    }

    const customerId = req.customer.userId;

    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(customerId)
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

// ==================== GET SINGLE ORDER ====================
router.get('/me/orders/:orderId', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({
        success: false,
        message: 'Database connecting...'
      });
    }

    const { orderId } = req.params;
    const customerId = req.customer.userId;

    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(customerId)
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const order = await db.collection('orders').findOne({
      order_number: orderId,
      $or: [
        { customer_email: customer.email },
        { phone: customer.phone }
      ]
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    res.json({
      success: true,
      order
    });
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order'
    });
  }
});

// ==================== DELETE CUSTOMER ACCOUNT ====================
router.delete('/me', requireCustomer, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({
        success: false,
        message: 'Database connecting...'
      });
    }

    const customerId = req.customer.userId;

    // Check if customer has pending orders
    const customer = await db.collection('customers').findOne({
      _id: new ObjectId(customerId)
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
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

    await db.collection('customers').deleteOne({
      _id: new ObjectId(customerId)
    });

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting customer:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account'
    });
  }
});

module.exports = router;
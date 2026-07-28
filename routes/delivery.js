const express = require('express');
const { body, validationResult } = require('express-validator');
const { getDB } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const { DEFAULT_DELIVERY } = require('../config/constants');

const router = express.Router();

// ==================== GET DELIVERY SETTINGS (Public) ====================
router.get('/delivery-settings', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.json({ 
        success: true, 
        settings: DEFAULT_DELIVERY 
      });
    }

    const settings = await db.collection('settings').findOne({ key: 'delivery' });
    
    res.json({ 
      success: true, 
      settings: settings?.value || DEFAULT_DELIVERY 
    });
  } catch (err) {
    console.error('Error fetching delivery settings:', err);
    res.json({ 
      success: true, 
      settings: DEFAULT_DELIVERY 
    });
  }
});

// ==================== GET DELIVERY SETTINGS (Admin) ====================
router.get('/admin/delivery-settings', requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.json({ 
        success: true, 
        settings: DEFAULT_DELIVERY 
      });
    }

    const settings = await db.collection('settings').findOne({ key: 'delivery' });
    
    res.json({ 
      success: true, 
      settings: settings?.value || DEFAULT_DELIVERY 
    });
  } catch (err) {
    console.error('Error fetching delivery settings:', err);
    res.json({ 
      success: true, 
      settings: DEFAULT_DELIVERY 
    });
  }
});

// ==================== UPDATE DELIVERY SETTINGS (Admin) ====================
router.post('/admin/delivery-settings', requireAdmin, [
  body('delivery_fee').optional().isNumeric().withMessage('Delivery fee must be a number'),
  body('free_delivery_threshold').optional().isNumeric().withMessage('Free delivery threshold must be a number'),
  body('delivery_enabled').optional().isBoolean().withMessage('Delivery enabled must be a boolean')
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

    const { delivery_fee, free_delivery_threshold, delivery_enabled } = req.body;

    await db.collection('settings').updateOne(
      { key: 'delivery' },
      {
        $set: {
          value: {
            delivery_fee: delivery_fee !== undefined ? delivery_fee : DEFAULT_DELIVERY.fee,
            free_delivery_threshold: free_delivery_threshold !== undefined ? free_delivery_threshold : DEFAULT_DELIVERY.freeThreshold,
            delivery_enabled: delivery_enabled !== undefined ? delivery_enabled : DEFAULT_DELIVERY.enabled
          },
          updated_at: new Date()
        }
      },
      { upsert: true }
    );

    res.json({ 
      success: true,
      message: 'Delivery settings updated successfully'
    });
  } catch (err) {
    console.error('Error saving delivery settings:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update delivery settings' 
    });
  }
});

// ==================== GET ALL DELIVERY ZONES (Public) ====================
router.get('/zones', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.json({
        success: true,
        zones: [],
        settings: DEFAULT_DELIVERY
      });
    }

    const zones = await db.collection('delivery_zones')
      .find({})
      .sort({ name: 1 })
      .toArray();
    
    const settings = await db.collection('settings').findOne({ key: 'delivery' });
    
    res.json({
      success: true,
      zones: zones,
      settings: settings?.value || DEFAULT_DELIVERY
    });
  } catch (err) {
    console.error('Error fetching delivery zones:', err);
    res.json({
      success: true,
      zones: [],
      settings: DEFAULT_DELIVERY
    });
  }
});

// ==================== GET DELIVERY ZONES (Admin) ====================
router.get('/admin/zones', requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

    const zones = await db.collection('delivery_zones')
      .find({})
      .sort({ name: 1 })
      .toArray();
    
    const settings = await db.collection('settings').findOne({ key: 'delivery' });
    
    res.json({
      success: true,
      zones: zones,
      settings: settings?.value || DEFAULT_DELIVERY
    });
  } catch (err) {
    console.error('Error fetching delivery zones:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch delivery zones' 
    });
  }
});

// ==================== SAVE DELIVERY ZONES (Admin) ====================
router.post('/admin/zones', requireAdmin, [
  body('zones').isArray().withMessage('Zones must be an array'),
  body('settings').optional().isObject().withMessage('Settings must be an object')
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

    const { zones, settings } = req.body;

    // Clear existing zones
    await db.collection('delivery_zones').deleteMany({});
    
    // Insert new zones
    if (zones && zones.length > 0) {
      const zonesToInsert = zones.map(z => ({
        name: z.name.trim(),
        fee: parseInt(z.fee) || 100,
        created_at: new Date(),
        updated_at: new Date()
      }));
      
      await db.collection('delivery_zones').insertMany(zonesToInsert);
    }

    // Update delivery settings if provided
    if (settings) {
      const { default_fee, free_threshold, enabled } = settings;
      const deliverySettings = {
        default_fee: default_fee !== undefined ? default_fee : DEFAULT_DELIVERY.fee,
        free_threshold: free_threshold !== undefined ? free_threshold : DEFAULT_DELIVERY.freeThreshold,
        enabled: enabled !== undefined ? enabled : DEFAULT_DELIVERY.enabled,
        updated_at: new Date()
      };
      
      await db.collection('settings').updateOne(
        { key: 'delivery' },
        { $set: { value: deliverySettings } },
        { upsert: true }
      );
    }
    
    res.json({ 
      success: true, 
      message: 'Delivery zones saved successfully' 
    });
  } catch (err) {
    console.error('Error saving delivery zones:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to save delivery zones' 
    });
  }
});

// ==================== CALCULATE DELIVERY FEE (Public) ====================
router.post('/calculate-fee', [
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
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

    const { area, subtotal = 0 } = req.body;
    
    // Get delivery settings
    const settings = await db.collection('settings').findOne({ key: 'delivery' });
    const defaultFee = settings?.value?.default_fee || DEFAULT_DELIVERY.fee;
    const freeThreshold = settings?.value?.free_threshold || DEFAULT_DELIVERY.freeThreshold;
    const enabled = settings?.value?.enabled !== false;
    
    if (!enabled) {
      return res.json({
        success: true,
        fee: 0,
        isFree: true,
        reason: 'Delivery is currently disabled'
      });
    }
    
    // Check if delivery is free based on subtotal
    if (subtotal && subtotal >= freeThreshold) {
      return res.json({
        success: true,
        fee: 0,
        isFree: true,
        reason: `Free delivery (order over KES ${freeThreshold.toLocaleString()})`
      });
    }
    
    // Find zone fee (case-insensitive)
    const zone = await db.collection('delivery_zones').findOne({
      name: { $regex: new RegExp('^' + area.trim() + '$', 'i') }
    });
    
    const fee = zone?.fee || defaultFee;
    
    res.json({
      success: true,
      fee: fee,
      isFree: false,
      zone: zone?.name || 'Default',
      reason: `Delivery fee for ${area}`
    });
  } catch (err) {
    console.error('Error calculating delivery fee:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to calculate delivery fee' 
    });
  }
});

// ==================== GET DEFAULT ZONES (Helper) ====================
router.get('/default-zones', async (req, res) => {
  const defaultZones = [
    { name: 'Dagoretti', fee: 100 },
    { name: 'Karen', fee: 100 },
    { name: 'Kilimani', fee: 100 },
    { name: 'Westlands', fee: 100 },
    { name: 'CBD', fee: 100 },
    { name: 'Upperhill', fee: 100 },
    { name: 'Lavington', fee: 100 },
    { name: 'Kileleshwa', fee: 100 },
    { name: 'Rongai', fee: 100 },
    { name: 'Ngong', fee: 100 },
    { name: 'South B', fee: 100 },
    { name: 'Langata', fee: 100 },
    { name: 'Waithaka', fee: 100 },
    { name: 'Kikuyu', fee: 100 },
    { name: 'Runda', fee: 100 }
  ];

  res.json({
    success: true,
    zones: defaultZones,
    settings: {
      default_fee: 100,
      free_threshold: 3000,
      enabled: true
    }
  });
});

module.exports = router;
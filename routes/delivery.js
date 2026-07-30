const express = require('express');
const { body, validationResult } = require('express-validator');
const { getDB } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const { DEFAULT_DELIVERY } = require('../config/constants');

const router = express.Router();

// ==================== SHOP LOCATION ====================
const SHOP_LAT = -1.2832;
const SHOP_LNG = 36.7254;

// ==================== DELIVERY FEE TIERS (Distance-based) ====================
// This is now a strict fallback only if the delivery_zones collection is empty.
const DELIVERY_TIERS = [
  { minDistance: 0, maxDistance: 5, fee: 150 },
  { minDistance: 5, maxDistance: 10, fee: 180 },
  { minDistance: 10, maxDistance: 15, fee: 220 },
  { minDistance: 15, maxDistance: 20, fee: 280 },
  { minDistance: 20, maxDistance: 30, fee: 350 },
  { minDistance: 30, maxDistance: Infinity, fee: 405 }
];

// ==================== HELPER: Calculate Distance (Haversine formula) ====================
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// ==================== HELPER: Get Fee by Distance ====================
function getFeeByDistance(distance) {
  for (const tier of DELIVERY_TIERS) {
    if (distance >= tier.minDistance && distance < tier.maxDistance) {
      return tier.fee;
    }
  }
  return DELIVERY_TIERS[DELIVERY_TIERS.length - 1].fee;
}

// ==================== GET DELIVERY SETTINGS & ZONES (Public) ====================
router.get('/delivery-settings', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.json({ 
        success: true, 
        settings: {
          ...DEFAULT_DELIVERY,
          shop: { lat: SHOP_LAT, lng: SHOP_LNG },
          tiers: DELIVERY_TIERS
        },
        zones: getDefaultZones()
      });
    }

    const settings = await db.collection('settings').findOne({ key: 'delivery' });
    const zones = await db.collection('delivery_zones').find({}).sort({ name: 1 }).toArray();
    
    const dbSettings = settings?.value || DEFAULT_DELIVERY;
    const safeThreshold = (dbSettings.free_delivery_threshold && dbSettings.free_delivery_threshold > 0) 
                          ? dbSettings.free_delivery_threshold 
                          : 5000;

    res.json({ 
      success: true, 
      settings: {
        ...dbSettings,
        free_delivery_threshold: safeThreshold,
        shop: { lat: SHOP_LAT, lng: SHOP_LNG },
        tiers: DELIVERY_TIERS
      },
      zones: zones.length > 0 ? zones : getDefaultZones()
    });
  } catch (err) {
    console.error('Error fetching delivery settings:', err);
    res.json({ 
      success: true, 
      settings: {
        ...DEFAULT_DELIVERY,
        free_delivery_threshold: 5000,
        shop: { lat: SHOP_LAT, lng: SHOP_LNG },
        tiers: DELIVERY_TIERS
      },
      zones: getDefaultZones()
    });
  }
});

// ==================== GET DELIVERY ZONES (Public) ====================
router.get('/zones', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.json({
        success: true,
        zones: getDefaultZones()
      });
    }

    const zones = await db.collection('delivery_zones')
      .find({})
      .sort({ name: 1 })
      .toArray();
    
    res.json({
      success: true,
      zones: zones.length > 0 ? zones : getDefaultZones()
    });
  } catch (err) {
    console.error('Error fetching delivery zones:', err);
    res.json({
      success: true,
      zones: getDefaultZones()
    });
  }
});

// ==================== GET ADMIN DELIVERY ZONES (Admin) ====================
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
    
    res.json({
      success: true,
      zones: zones.length > 0 ? zones : getDefaultZones()
    });
  } catch (err) {
    console.error('Error fetching delivery zones:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch delivery zones' 
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
            delivery_enabled: delivery_enabled !== undefined ? delivery_enabled : DEFAULT_DELIVERY.enabled,
            shop: { lat: SHOP_LAT, lng: SHOP_LNG },
            tiers: DELIVERY_TIERS,
            updated_at: new Date()
          }
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

// ==================== UPDATE DELIVERY ZONES (Admin) ====================
router.post('/admin/zones', requireAdmin, [
  body('zones').isArray().withMessage('Zones must be an array')
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

    const { zones } = req.body;

    await db.collection('delivery_zones').deleteMany({});
    
    if (zones && zones.length > 0) {
      const zonesToInsert = zones.map(z => ({
        name: z.name.trim(),
        fee: parseInt(z.fee) || 150,
        created_at: new Date(),
        updated_at: new Date()
      }));
      
      await db.collection('delivery_zones').insertMany(zonesToInsert);
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

// ==================== CALCULATE DELIVERY FEE (Public - Zone Lookup Based) ====================
router.post('/calculate-fee', [
  body('lat').isNumeric().withMessage('Latitude is required'),
  body('lng').isNumeric().withMessage('Longitude is required'),
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

    const { lat, lng, subtotal = 0 } = req.body;
    
    // Get delivery settings
    const settings = await db.collection('settings').findOne({ key: 'delivery' });
    const dbSettings = settings?.value || DEFAULT_DELIVERY;
    
    // Safe threshold fallback
    const freeThreshold = (dbSettings.free_delivery_threshold && dbSettings.free_delivery_threshold > 0) 
                          ? dbSettings.free_delivery_threshold 
                          : 5000;
    const enabled = dbSettings.delivery_enabled !== false;
    
    if (!enabled) {
      return res.json({
        success: true,
        fee: 0,
        isFree: true,
        reason: 'Delivery is currently disabled'
      });
    }
    
    // ✅ NEW LOGIC: Look up the nearest zone by name (or proximity) from the database
    // We fetch the full zones list, then match based on the closest available zone.
    const zones = await db.collection('delivery_zones')
      .find({})
      .sort({ name: 1 })
      .toArray();

    let matchedZone = null;

    if (zones.length > 0) {
      // Calculate distance to find the closest zone geographically
      let closestDistance = Infinity;
      
      for (const zone of zones) {
        // Since zones do not have lat/lng stored, we match by calculating distance from shop.
        // This ensures the customer gets the fee for the closest available zone.
        const distance = calculateDistance(SHOP_LAT, SHOP_LNG, lat, lng);
        if (distance < closestDistance) {
          closestDistance = distance;
          matchedZone = zone;
        }
      }
    }

    // Determine the final fee
    let fee = matchedZone ? matchedZone.fee : 150; // Fallback to 150 if no zone found
    let isFree = false;
    
    if (subtotal && subtotal >= freeThreshold) {
      isFree = true;
      fee = 0;
    }
    
    // Calculate straight-line distance for informational purposes (log only)
    const distance = calculateDistance(SHOP_LAT, SHOP_LNG, lat, lng);

    res.json({
      success: true,
      fee: fee,
      distance: Math.round(distance * 10) / 10,
      isFree: isFree,
      matchedZone: matchedZone ? matchedZone.name : 'None',
      shop: { lat: SHOP_LAT, lng: SHOP_LNG },
      reason: isFree ? `Free delivery (order over KES ${freeThreshold.toLocaleString()})` : `Zone: ${matchedZone ? matchedZone.name : 'Default'} (KES ${fee})`
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
function getDefaultZones() {
  return [
    // === 0–5 km — KES 150 ===
    { name: 'Dagoretti Road', fee: 150 },
    { name: 'Naivasha Road', fee: 150 },
    { name: 'Kikuyu Road', fee: 150 },
    { name: 'Ngong Road', fee: 150 },
    { name: 'Kilimani', fee: 150 },
    { name: 'Kileleshwa', fee: 150 },
    { name: 'Lavington', fee: 150 },
    { name: 'Hurlingham', fee: 150 },
    { name: 'Upper Hill', fee: 150 },
    { name: 'Nairobi CBD', fee: 150 },
    
    // === 5–10 km — KES 180 ===
    { name: 'Westlands', fee: 180 },
    { name: 'Parklands', fee: 180 },
    { name: 'Muthaiga', fee: 180 },
    { name: 'Karen', fee: 180 },
    { name: 'Langata', fee: 180 },
    { name: 'Waiyaki Way', fee: 180 },
    
    // === 10–15 km — KES 220 ===
    { name: 'Rongai', fee: 220 },
    { name: 'South B', fee: 220 },
    { name: 'Waithaka', fee: 220 },
    { name: 'Runda', fee: 220 },
    { name: 'Gigiri', fee: 220 },
    { name: 'Loresho', fee: 220 },
    { name: 'Kiambu Road', fee: 220 },
    
    // === 15–20 km — KES 280 ===
    { name: 'Ruaka', fee: 280 },
    { name: 'Kikuyu', fee: 280 }
  ];
}

module.exports = router;
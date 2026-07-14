const express = require('express');
const { getDB } = require('../config/database');
const { authenticateAdmin } = require('../middleware/auth');

const router = express.Router();

// ==================== GET DELIVERY ZONES ====================
router.get('/', async (req, res) => {
  const db = getDB();
  if (!db) {
    return res.status(503).json({
      success: false,
      message: 'Database connecting...'
    });
  }

  try {
    const zones = await db.collection('delivery_zones').find({}).toArray();
    res.json({
      success: true,
      zones: zones.length > 0 ? zones : getDefaultZones()
    });
  } catch (err) {
    console.error('Error loading delivery zones:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to load delivery zones'
    });
  }
});

// ==================== UPDATE DELIVERY ZONES ====================
router.put('/', authenticateAdmin, async (req, res) => {
  const { zones } = req.body;
  const db = getDB();
  
  if (!db) {
    return res.status(503).json({
      success: false,
      message: 'Database connecting...'
    });
  }

  if (!zones || !Array.isArray(zones)) {
    return res.status(400).json({
      success: false,
      message: 'Zones array required'
    });
  }

  try {
    // Clear existing zones
    await db.collection('delivery_zones').deleteMany({});
    
    // Insert new zones
    if (zones.length > 0) {
      const zonesWithTimestamps = zones.map(z => ({
        ...z,
        created_at: new Date(),
        updated_at: new Date()
      }));
      await db.collection('delivery_zones').insertMany(zonesWithTimestamps);
    }
    
    res.json({
      success: true,
      message: 'Delivery zones updated successfully'
    });
  } catch (err) {
    console.error('Error saving delivery zones:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to save delivery zones'
    });
  }
});

function getDefaultZones() {
  return [
    { name: 'Dagoretti', fee: 0 },
    { name: 'Karen', fee: 50 },
    { name: 'Westlands', fee: 100 },
    { name: 'CBD', fee: 80 },
    { name: 'Upperhill', fee: 70 },
    { name: 'Kilimani', fee: 60 },
    { name: 'Lavington', fee: 80 },
    { name: 'Kileleshwa', fee: 70 },
    { name: 'Rongai', fee: 120 },
    { name: 'Ngong', fee: 150 },
    { name: 'South B', fee: 100 },
    { name: 'Langata', fee: 130 },
    { name: 'Waithaka', fee: 140 },
    { name: 'Kikuyu', fee: 160 },
    { name: 'Runda', fee: 180 }
  ];
}

module.exports = router;
const express = require('express');
const { getDB } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');

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
router.put('/', requireAdmin, async (req, res) => {
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
    await db.collection('delivery_zones').deleteMany({});
    
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
    { name: 'Kikuyu', fee: 280 },
    
    // === 20–30 km — KES 350 ===
    // All other Nairobi suburbs
    
    // === 30+ km — KES 405 ===
    // Anywhere beyond 30km (countrywide delivery)
  ];
}

module.exports = router;
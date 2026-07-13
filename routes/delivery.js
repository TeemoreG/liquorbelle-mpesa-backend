const express = require('express');
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
router.post('/admin/delivery-settings', requireAdmin, async (req, res) => {
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

    res.json({ success: true });
  } catch (err) {
    console.error('Error saving delivery settings:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update delivery settings' 
    });
  }
});

module.exports = router;
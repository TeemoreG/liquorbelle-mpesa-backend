const express = require('express');
const axios = require('axios');
const { geocodeLimiter } = require('../config/rateLimits');

const router = express.Router();

// ==================== REVERSE GEOCODING ====================
router.post('/reverse', geocodeLimiter, async (req, res) => {
  const { lat, lng } = req.body;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'Latitude and longitude required' });
  }

  try {
    let addressData = null;
    let usedService = '';

    // ===== OPTION 1: Try geocode.maps.co first (if API key exists) =====
    const MAP_MAKER_KEY = process.env.MAP_MAKER_API_KEY;
    
    if (MAP_MAKER_KEY) {
      try {
        const url = `https://geocode.maps.co/reverse?lat=${lat}&lon=${lng}&api_key=${MAP_MAKER_KEY}`;
        const response = await axios.get(url, { timeout: 8000 });
        
        if (response.data && response.data.address) {
          addressData = response.data;
          usedService = 'geocode.maps.co';
          console.log(`📍 geocode.maps.co found address for ${lat}, ${lng}`);
        }
      } catch (err) {
        console.log('⚠️ geocode.maps.co failed, falling back to Nominatim');
      }
    }

    // ===== OPTION 2: Fallback to Nominatim =====
    if (!addressData) {
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&countrycodes=ke`;
        const response = await axios.get(url, {
          timeout: 8000,
          headers: {
            'User-Agent': 'LiquorBelle/1.0 (https://liquorbelle.com)'
          }
        });
        
        if (response.data && response.data.address) {
          addressData = response.data;
          usedService = 'Nominatim';
          console.log(`📍 Nominatim found address for ${lat}, ${lng}`);
        }
      } catch (err) {
        console.log('⚠️ Nominatim also failed:', err.message);
      }
    }

    // ===== Return result =====
    if (addressData) {
      return res.json({
        ...addressData,
        _service: usedService,
        _timestamp: new Date().toISOString()
      });
    }

    // ===== NO ADDRESS FOUND =====
    return res.status(404).json({
      error: 'Could not find address for these coordinates',
      lat,
      lng,
      message: 'Try manually entering your address'
    });

  } catch (err) {
    console.error('❌ Geocoding error:', err.message);
    res.status(500).json({ 
      error: 'Geocoding failed',
      message: err.message
    });
  }
});

module.exports = router;
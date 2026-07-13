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

  const MAP_MAKER_KEY = process.env.MAP_MAKER_API_KEY;

  let url;
  if (MAP_MAKER_KEY) {
    url = `https://geocode.maps.co/reverse?lat=${lat}&lon=${lng}&api_key=${MAP_MAKER_KEY}`;
  } else {
    url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&countrycodes=ke`;
  }

  try {
    const response = await axios.get(url, { timeout: 8000 });
    res.json(response.data);
  } catch (err) {
    console.error('Geocoding error:', err.message);
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

module.exports = router;
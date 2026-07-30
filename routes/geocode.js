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
    let rawResponse = null;

    // ===== OPTION 1: LocationIQ (Primary - 5,000 req/day) =====
    const LOCATIONIQ_TOKEN = process.env.LOCATIONIQ_API_KEY;
    if (LOCATIONIQ_TOKEN) {
      try {
        const url = `https://us1.locationiq.com/v1/reverse?key=${LOCATIONIQ_TOKEN}&lat=${lat}&lon=${lng}&format=json`;
        const response = await axios.get(url, { timeout: 5000 });

        if (response.data && response.data.address) {
          const addr = response.data.address;
          addressData = {
            address: {
              road: addr.road || addr.pedestrian || addr.footway || 'Location found',
              suburb: addr.suburb || addr.neighbourhood || addr.village || addr.town || addr.city || 'Nairobi',
              city: addr.city || addr.town || 'Nairobi',
              county: addr.county || addr.state || addr.region || 'Nairobi',
              country: addr.country || 'Kenya'
            },
            formatted_address: response.data.display_name,
            raw: response.data
          };
          usedService = 'LocationIQ';
          console.log(`📍 LocationIQ found address for ${lat}, ${lng}`);
        }
      } catch (err) {
        console.log('⚠️ LocationIQ failed:', err.message);
      }
    }

    // ===== OPTION 2: Geoapify (Fallback - 3,000 req/day) =====
    if (!addressData) {
      const GEOAPIFY_KEY = process.env.GEOAPIFY_API_KEY;
      if (GEOAPIFY_KEY) {
        try {
          const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&apiKey=${GEOAPIFY_KEY}&format=json`;
          const response = await axios.get(url, { timeout: 5000 });

          if (response.data && response.data.results && response.data.results.length > 0) {
            const result = response.data.results[0];
            addressData = {
              address: {
                road: result.street || result.road || 'Location found',
                suburb: result.suburb || result.district || result.city || 'Nairobi',
                city: result.city || result.town || 'Nairobi',
                county: result.county || result.state || 'Nairobi',
                country: result.country || 'Kenya'
              },
              formatted_address: result.formatted || result.address_line1 || '',
              raw: result
            };
            usedService = 'Geoapify';
            console.log(`📍 Geoapify found address for ${lat}, ${lng}`);
          }
        } catch (err) {
          console.log('⚠️ Geoapify failed:', err.message);
        }
      }
    }

    // ===== OPTION 3: geocode.maps.co (Final fallback) =====
    if (!addressData) {
      const MAP_MAKER_KEY = process.env.MAP_MAKER_API_KEY;
      if (MAP_MAKER_KEY) {
        try {
          const url = `https://geocode.maps.co/reverse?lat=${lat}&lon=${lng}&api_key=${MAP_MAKER_KEY}`;
          const response = await axios.get(url, { timeout: 8000 });
          
          if (response.data && response.data.address) {
            const addr = response.data.address;
            addressData = {
              address: {
                road: addr.road || addr.pedestrian || addr.footway || 'Location found',
                suburb: addr.suburb || addr.neighbourhood || addr.village || addr.town || addr.city || 'Nairobi',
                city: addr.city || addr.town || 'Nairobi',
                county: addr.county || addr.state || addr.region || 'Nairobi',
                country: addr.country || 'Kenya'
              },
              formatted_address: response.data.display_name,
              raw: response.data
            };
            usedService = 'geocode.maps.co';
            console.log(`📍 geocode.maps.co found address for ${lat}, ${lng}`);
          }
        } catch (err) {
          console.log('⚠️ geocode.maps.co failed');
        }
      }
    }

    // ===== OPTION 4: Free Nominatim (Ultimate fallback) =====
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
          const addr = response.data.address;
          addressData = {
            address: {
              road: addr.road || addr.pedestrian || addr.footway || 'Location found',
              suburb: addr.suburb || addr.neighbourhood || addr.village || addr.town || addr.city || 'Nairobi',
              city: addr.city || addr.town || 'Nairobi',
              county: addr.county || addr.state || addr.region || 'Nairobi',
              country: addr.country || 'Kenya'
            },
            formatted_address: response.data.display_name,
            raw: response.data
          };
          usedService = 'Nominatim';
          console.log(`📍 Nominatim found address for ${lat}, ${lng}`);
        }
      } catch (err) {
        console.log('⚠️ Nominatim failed:', err.message);
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

    // ===== NO ADDRESS FOUND - Return fallback =====
    console.log(`⚠️ No address found for ${lat}, ${lng}, returning fallback`);
    return res.json({
      address: {
        road: 'Location found',
        suburb: 'Nairobi',
        city: 'Nairobi',
        county: 'Nairobi',
        country: 'Kenya'
      },
      _service: 'fallback',
      _timestamp: new Date().toISOString(),
      _note: 'Basic address returned - geocoding services unavailable'
    });

  } catch (err) {
    console.error('❌ Geocoding error:', err.message);
    return res.json({
      address: {
        road: 'Location found',
        suburb: 'Nairobi',
        city: 'Nairobi',
        county: 'Nairobi',
        country: 'Kenya'
      },
      _service: 'error_fallback',
      _timestamp: new Date().toISOString(),
      _note: 'Geocoding error - basic address returned'
    });
  }
});

module.exports = router;
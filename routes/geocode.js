const express = require('express');
const axios = require('axios');
const { geocodeLimiter } = require('../config/rateLimits');

const router = express.Router();

// ============================================================
// 1. CONSTANTS & HELPERS
// ============================================================

// 40km "Priority" bounding box around Nairobi CBD.
// Used for future-proofing if needed.
const NAIROBI_40KM_BOX = '36.40,-1.70,37.20,-0.80';

function patchNairobiRoads(road, suburb) {
  if (!road) return 'Location found';
  const cleanRoad = road.toLowerCase();
  const cleanSuburb = suburb ? suburb.toLowerCase() : '';

  // Fix the Kikuyu Rd vs Dagoretti Rd overlap near Waithaka/Riruta
  if (cleanRoad.includes('kikuyu') && 
      (cleanSuburb.includes('riruta') || cleanSuburb.includes('waithaka') || cleanSuburb.includes('dagoretti'))) {
    return 'Dagoretti Road'; 
  }
  return road;
}

function formatAddressForDisplay(displayName) {
  if (!displayName) return 'Kenya';
  const parts = displayName.split(',').map(p => p.trim());
  return parts.length >= 1 ? parts[0] : displayName;
}

// ============================================================
// 2. REVERSE GEOCODING (GPS -> Address) - For the PIN button ONLY
// ============================================================
router.post('/reverse', geocodeLimiter, async (req, res) => {
  const { lat, lng } = req.body;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'Latitude and longitude required' });
  }

  try {
    let addressData = null;
    let usedService = '';

    // ----- OPTION 1: LocationIQ (Primary) -----
    const LOCATIONIQ_TOKEN = process.env.LOCATIONIQ_API_KEY;
    if (LOCATIONIQ_TOKEN) {
      try {
        const url = `https://us1.locationiq.com/v1/reverse?key=${LOCATIONIQ_TOKEN}&lat=${lat}&lon=${lng}&format=json`;
        const response = await axios.get(url, { timeout: 5000 });

        if (response.data && response.data.address) {
          const addr = response.data.address;
          const rawRoad = addr.road || addr.pedestrian || addr.footway || 'Location found';
          const currentSuburb = addr.suburb || addr.neighbourhood || addr.village || addr.town || addr.city || 'Kenya';

          addressData = {
            address: {
              road: patchNairobiRoads(rawRoad, currentSuburb),
              suburb: currentSuburb,
              city: addr.city || addr.town || addr.county || 'Kenya',
              county: addr.county || addr.state || addr.region || 'Kenya',
              country: addr.country || 'Kenya'
            },
            formatted_address: response.data.display_name,
            raw: response.data
          };
          usedService = 'LocationIQ';
        }
      } catch (err) {
        console.log('⚠️ LocationIQ reverse failed:', err.message);
      }
    }

    // ----- OPTION 2: Geoapify (Fallback) -----
    if (!addressData) {
      const GEOAPIFY_KEY = process.env.GEOAPIFY_API_KEY;
      if (GEOAPIFY_KEY) {
        try {
          const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&apiKey=${GEOAPIFY_KEY}&format=json`;
          const response = await axios.get(url, { timeout: 5000 });

          if (response.data && response.data.results && response.data.results.length > 0) {
            const result = response.data.results[0];
            const rawRoad = result.street || result.road || 'Location found';
            const currentSuburb = result.suburb || result.district || result.city || 'Kenya';

            addressData = {
              address: {
                road: patchNairobiRoads(rawRoad, currentSuburb),
                suburb: currentSuburb,
                city: result.city || result.town || 'Kenya',
                county: result.county || result.state || 'Kenya',
                country: result.country || 'Kenya'
              },
              formatted_address: result.formatted || result.address_line1 || '',
              raw: result
            };
            usedService = 'Geoapify';
          }
        } catch (err) {
          console.log('⚠️ Geoapify reverse failed:', err.message);
        }
      }
    }

    // ----- OPTION 3: Nominatim (Ultimate fallback) -----
    if (!addressData) {
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&countrycodes=ke`;
        const response = await axios.get(url, {
          timeout: 8000,
          headers: { 'User-Agent': 'LiquorBelle/1.0 (https://liquorbelle.com)' }
        });

        if (response.data && response.data.address) {
          const addr = response.data.address;
          const rawRoad = addr.road || addr.pedestrian || addr.footway || 'Location found';
          const currentSuburb = addr.suburb || addr.neighbourhood || addr.village || addr.town || addr.city || 'Kenya';

          addressData = {
            address: {
              road: patchNairobiRoads(rawRoad, currentSuburb),
              suburb: currentSuburb,
              city: addr.city || addr.town || 'Kenya',
              county: addr.county || addr.state || addr.region || 'Kenya',
              country: addr.country || 'Kenya'
            },
            formatted_address: response.data.display_name,
            raw: response.data
          };
          usedService = 'Nominatim';
        }
      } catch (err) {
        console.log('⚠️ Nominatim reverse failed:', err.message);
      }
    }

    if (addressData) {
      return res.json({ ...addressData, _service: usedService, _timestamp: new Date().toISOString() });
    }

    return res.json({
      address: { road: 'Location found', suburb: 'Kenya', city: 'Kenya', county: 'Kenya', country: 'Kenya' },
      _service: 'fallback',
      _timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Geocoding reverse error:', err.message);
    return res.json({
      address: { road: 'Location found', suburb: 'Kenya', city: 'Kenya', county: 'Kenya', country: 'Kenya' },
      _service: 'error_fallback',
      _timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
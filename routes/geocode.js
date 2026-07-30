const express = require('express');
const axios = require('axios');
const { geocodeLimiter } = require('../config/rateLimits');

const router = express.Router();

// ==================== REVERSE GEOCODING (GPS -> Address) ====================
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

// ==================== 🔥 NEW: SEARCH BUILDINGS (Text -> Address) ====================
router.post('/search', geocodeLimiter, async (req, res) => {
  const { query, limit = 8, category } = req.body;

  if (!query || query.length < 2) {
    return res.status(400).json({ success: false, message: 'Search query must be at least 2 characters' });
  }

  try {
    let results = [];
    let usedService = '';

    // ===== OPTION 1: Use LocationIQ Search (Primary) =====
    const LOCATIONIQ_TOKEN = process.env.LOCATIONIQ_API_KEY;
    if (LOCATIONIQ_TOKEN) {
      try {
        // Build query with category filter if provided
        let searchQuery = query;
        if (category) {
          // LocationIQ doesn't support strict category filtering like Geoapify,
          // so we append the category to improve results
          searchQuery = `${query} ${category}`;
        }

        const url = `https://us1.locationiq.com/v1/search?key=${LOCATIONIQ_TOKEN}&q=${encodeURIComponent(searchQuery)}&format=json&limit=${limit}`;
        const response = await axios.get(url, { timeout: 5000 });

        if (response.data && Array.isArray(response.data)) {
          results = response.data.map((place) => ({
            name: place.display_name.split(',')[0] || place.display_name,
            display_name: place.display_name,
            lat: parseFloat(place.lat),
            lon: parseFloat(place.lon),
            type: place.type || 'building',
            class: place.class || 'building'
          }));
          usedService = 'LocationIQ';
          console.log(`📍 LocationIQ search found ${results.length} results for "${query}"`);
        }
      } catch (err) {
        console.log('⚠️ LocationIQ search failed:', err.message);
      }
    }

    // ===== OPTION 2: Geoapify Search (Fallback) =====
    if (results.length === 0) {
      const GEOAPIFY_KEY = process.env.GEOAPIFY_API_KEY;
      if (GEOAPIFY_KEY) {
        try {
          let url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(query)}&apiKey=${GEOAPIFY_KEY}&limit=${limit}&format=json`;
          // Add category filter for buildings/commercial/residential
          if (category) {
            url += `&filter=category:${category}`;
          }
          
          const response = await axios.get(url, { timeout: 5000 });

          if (response.data && response.data.results) {
            results = response.data.results.map((place) => ({
              name: place.address_line1 || place.formatted?.split(',')[0] || place.name || 'Location',
              display_name: place.formatted || place.address_line1 || place.name,
              lat: place.lat,
              lon: place.lon,
              type: place.category || 'building',
              class: place.category || 'building'
            }));
            usedService = 'Geoapify';
            console.log(`📍 Geoapify search found ${results.length} results for "${query}"`);
          }
        } catch (err) {
          console.log('⚠️ Geoapify search failed:', err.message);
        }
      }
    }

    // ===== OPTION 3: OpenStreetMap Nominatim (Ultimate Fallback) =====
    if (results.length === 0) {
      try {
        let searchQuery = query;
        // Constrain to Nairobi/Kenya for better local results
        if (!query.toLowerCase().includes('nairobi')) {
          searchQuery = `${query}, Nairobi, Kenya`;
        }

        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=${limit}&addressdetails=1&countrycodes=ke`;
        const response = await axios.get(url, {
          timeout: 8000,
          headers: {
            'User-Agent': 'LiquorBelle/1.0 (https://liquorbelle.com)'
          }
        });

        if (response.data && Array.isArray(response.data)) {
          results = response.data.map((place) => ({
            name: place.display_name.split(',')[0] || place.display_name,
            display_name: place.display_name,
            lat: parseFloat(place.lat),
            lon: parseFloat(place.lon),
            type: place.type || place.class || 'building',
            class: place.class || place.type || 'building'
          }));
          usedService = 'Nominatim';
          console.log(`📍 Nominatim search found ${results.length} results for "${query}"`);
        }
      } catch (err) {
        console.log('⚠️ Nominatim search failed:', err.message);
      }
    }

    // Return standardized response
    return res.json({
      success: true,
      results: results,
      count: results.length,
      _service: usedService || 'none',
      _timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Geocoding search error:', err.message);
    return res.status(500).json({
      success: false,
      results: [],
      message: 'Search failed',
      _error: err.message,
      _timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
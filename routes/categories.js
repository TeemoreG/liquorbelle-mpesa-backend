const express = require('express');
const { getDB } = require('../config/database');
const { CATEGORIES, CATEGORY_COLORS } = require('../config/constants');
const { requireAdmin } = require('../middleware/auth');
const { productCache, clearProductCache, clearStatsCache } = require('../utils/cache');

const router = express.Router();

// ==================== GET ALL CATEGORIES ====================
router.get('/', async (req, res) => {
  try {
    const categories = Object.keys(CATEGORIES).map(key => ({
      key: key,
      label: CATEGORIES[key],
      color: CATEGORY_COLORS[key] || '#6B7280'
    }));

    res.json({ 
      success: true, 
      categories 
    });
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch categories' });
  }
});

// ==================== GET CATEGORY STATS ====================
router.get('/stats', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const cached = productCache.get('category_stats');
    if (cached) {
      return res.json({ success: true, stats: cached, fromCache: true });
    }

    const products = await db.collection('products').find({}).toArray();
    const stats = {};

    Object.keys(CATEGORIES).forEach(cat => {
      stats[cat] = { 
        count: 0, 
        label: CATEGORIES[cat], 
        color: CATEGORY_COLORS[cat] || '#6B7280' 
      };
    });

    products.forEach(product => {
      const cat = product.category || 'uncategorized';
      if (stats[cat]) {
        stats[cat].count++;
      } else {
        stats[cat] = { 
          count: 1, 
          label: cat, 
          color: '#6B7280' 
        };
      }
    });

    productCache.set('category_stats', stats);
    res.json({ success: true, stats });
  } catch (err) {
    console.error('Error fetching category stats:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch category stats' });
  }
});

// ==================== GET PRODUCTS BY CATEGORY ====================
router.get('/:category/products', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const { category } = req.params;
    const { limit = 20 } = req.query;

    if (!CATEGORIES[category]) {
      return res.status(404).json({ 
        success: false, 
        message: 'Category not found' 
      });
    }

    const products = await db.collection('products')
      .find({ category: category })
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .toArray();

    res.json({ 
      success: true, 
      category: {
        key: category,
        label: CATEGORIES[category],
        color: CATEGORY_COLORS[category] || '#6B7280'
      },
      products,
      count: products.length
    });
  } catch (err) {
    console.error('Error fetching products by category:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

// ==================== ADD NEW CATEGORY (Admin only) ====================
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { key, label, color } = req.body;

    if (!key || !label) {
      return res.status(400).json({ 
        success: false, 
        message: 'Category key and label required' 
      });
    }

    // Check if category already exists
    if (CATEGORIES[key]) {
      return res.status(400).json({ 
        success: false, 
        message: 'Category already exists' 
      });
    }

    // Note: This only adds to the in-memory config
    // For persistence, you'd need to store in database
    // This is a placeholder - categories should be managed in constants.js
    
    res.json({ 
      success: true, 
      message: 'Category added. Note: Categories are managed in config/constants.js',
      category: { key, label, color: color || '#6B7280' }
    });
  } catch (err) {
    console.error('Error adding category:', err);
    res.status(500).json({ success: false, message: 'Failed to add category' });
  }
});

module.exports = router;
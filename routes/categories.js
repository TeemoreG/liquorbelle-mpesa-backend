const express = require('express');
const { body, validationResult } = require('express-validator');
const { getDB } = require('../config/database');
const { CATEGORIES, CATEGORY_COLORS } = require('../config/constants');
const { requireAdmin } = require('../middleware/auth');
const { productCache, clearProductCache, clearStatsCache } = require('../utils/cache');

const router = express.Router();

// ==================== GET ALL CATEGORIES (Including Custom) ====================
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    
    // Start with built-in categories
    const categories = Object.keys(CATEGORIES).map(key => ({
      key: key,
      label: CATEGORIES[key],
      color: CATEGORY_COLORS[key] || '#6B7280',
      builtin: true
    }));

    // Add custom categories from database if available
    if (db) {
      const customCategories = await db.collection('categories')
        .find({})
        .sort({ label: 1 })
        .toArray();
      
      customCategories.forEach(c => {
        categories.push({
          key: c.key,
          label: c.label,
          color: c.color || '#6B7280',
          builtin: false,
          _id: c._id
        });
      });
    }

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

    // Initialize with built-in categories
    Object.keys(CATEGORIES).forEach(cat => {
      stats[cat] = { 
        count: 0, 
        label: CATEGORIES[cat], 
        color: CATEGORY_COLORS[cat] || '#6B7280' 
      };
    });

    // Add custom categories from database
    const customCategories = await db.collection('categories').find({}).toArray();
    customCategories.forEach(c => {
      stats[c.key] = { 
        count: 0, 
        label: c.label, 
        color: c.color || '#6B7280' 
      };
    });

    // Count products per category
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

    // Check if category exists (built-in or custom)
    let categoryExists = false;
    let categoryLabel = category;
    let categoryColor = '#6B7280';

    // Check built-in
    if (CATEGORIES[category]) {
      categoryExists = true;
      categoryLabel = CATEGORIES[category];
      categoryColor = CATEGORY_COLORS[category] || '#6B7280';
    } else {
      // Check custom categories
      const customCat = await db.collection('categories').findOne({ key: category });
      if (customCat) {
        categoryExists = true;
        categoryLabel = customCat.label;
        categoryColor = customCat.color || '#6B7280';
      }
    }

    if (!categoryExists) {
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
        label: categoryLabel,
        color: categoryColor
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
router.post('/', requireAdmin, [
  body('key').notEmpty().withMessage('Category key required')
    .matches(/^[a-z0-9_]+$/).withMessage('Key must be lowercase, alphanumeric with underscores'),
  body('label').notEmpty().withMessage('Category label required'),
  body('color').optional().isString().withMessage('Color must be a string')
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

    const { key, label, color } = req.body;
    const categoryKey = key.toLowerCase();

    // Check if category already exists in built-in
    if (CATEGORIES[categoryKey]) {
      return res.status(400).json({ 
        success: false, 
        message: `Category "${label}" already exists in system` 
      });
    }

    // Check if category already exists in database
    const existing = await db.collection('categories').findOne({ key: categoryKey });
    if (existing) {
      return res.status(400).json({ 
        success: false, 
        message: `Category key "${categoryKey}" already exists` 
      });
    }

    const newCategory = {
      key: categoryKey,
      label: label.trim(),
      color: color || '#6B7280',
      created_at: new Date(),
      updated_at: new Date()
    };

    const result = await db.collection('categories').insertOne(newCategory);

    // Clear cache
    productCache.del('category_stats');
    clearStatsCache();

    res.json({ 
      success: true, 
      message: `Category "${label}" added successfully`,
      category: { _id: result.insertedId, ...newCategory, builtin: false }
    });
  } catch (err) {
    console.error('Error adding category:', err);
    res.status(500).json({ success: false, message: 'Failed to add category' });
  }
});

// ==================== DELETE CATEGORY (Admin only) ====================
router.delete('/:key', requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

    const { key } = req.params;

    // Prevent deleting built-in categories
    if (CATEGORIES[key]) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete built-in category "${CATEGORIES[key]}"`
      });
    }

    // Check if category exists in database
    const existing = await db.collection('categories').findOne({ key });
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check if category is being used by any products
    const productsCount = await db.collection('products').countDocuments({ category: key });
    if (productsCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category "${existing.label}" — it is used by ${productsCount} product(s)`
      });
    }

    await db.collection('categories').deleteOne({ key });

    // Clear cache
    productCache.del('category_stats');
    clearStatsCache();

    res.json({ 
      success: true, 
      message: `Category "${existing.label}" deleted successfully` 
    });
  } catch (err) {
    console.error('Error deleting category:', err);
    res.status(500).json({ success: false, message: 'Failed to delete category' });
  }
});

// ==================== UPDATE CATEGORY (Admin only) ====================
router.put('/:key', requireAdmin, [
  body('label').optional().isString().withMessage('Label must be a string'),
  body('color').optional().isString().withMessage('Color must be a string')
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

    const { key } = req.params;
    const { label, color } = req.body;

    // Prevent updating built-in categories
    if (CATEGORIES[key]) {
      return res.status(400).json({
        success: false,
        message: `Cannot update built-in category "${CATEGORIES[key]}"`
      });
    }

    // Check if category exists in database
    const existing = await db.collection('categories').findOne({ key });
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const updateData = {
      updated_at: new Date()
    };
    if (label) updateData.label = label.trim();
    if (color) updateData.color = color;

    await db.collection('categories').updateOne(
      { key },
      { $set: updateData }
    );

    // Clear cache
    productCache.del('category_stats');
    clearStatsCache();

    res.json({ 
      success: true, 
      message: `Category updated successfully`,
      category: { ...existing, ...updateData }
    });
  } catch (err) {
    console.error('Error updating category:', err);
    res.status(500).json({ success: false, message: 'Failed to update category' });
  }
});

module.exports = router;
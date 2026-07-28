const express = require('express');
const { body, validationResult } = require('express-validator');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const { productCache, clearProductCache, clearProductCacheById, clearStatsCache } = require('../utils/cache');
const { CATEGORIES } = require('../config/constants');

const router = express.Router();

// ==================== HELPER: Validate Category ====================
async function isValidCategory(category) {
  // Check built-in categories
  if (CATEGORIES[category]) {
    return true;
  }
  
  // Check custom categories in database
  try {
    const db = getDB();
    if (!db) return false;
    
    const customCategory = await db.collection('categories').findOne({ key: category });
    return !!customCategory;
  } catch (err) {
    return false;
  }
}

// ==================== GET ALL PRODUCTS ====================
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const cached = productCache.get('all_products');
    if (cached) {
      return res.json({ success: true, products: cached, fromCache: true });
    }

    const products = await db.collection('products').find({}).sort({ created_at: -1 }).toArray();
    productCache.set('all_products', products);
    res.json({ success: true, products });
  } catch (err) {
    console.error('Error fetching products:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

// ==================== GET PRODUCT BY ID ====================
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const { id } = req.params;
    const cacheKey = 'product_' + id;
    const cached = productCache.get(cacheKey);

    if (cached) {
      return res.json({ success: true, product: cached, fromCache: true });
    }

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    const product = await db.collection('products').findOne({ _id: new ObjectId(id) });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    productCache.set(cacheKey, product);
    res.json({ success: true, product });
  } catch (err) {
    console.error('Error fetching product:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch product' });
  }
});

// ==================== GET PRODUCTS BY CATEGORY ====================
router.get('/category/:category', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    const { category } = req.params;
    const { limit = 50 } = req.query;

    // Check if category exists (built-in or custom)
    let categoryExists = false;
    if (CATEGORIES[category]) {
      categoryExists = true;
    } else {
      const customCategory = await db.collection('categories').findOne({ key: category });
      if (customCategory) categoryExists = true;
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
      products,
      count: products.length,
      category: category
    });
  } catch (err) {
    console.error('Error fetching products by category:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

// ==================== CREATE PRODUCT ====================
router.post('/', requireAdmin, [
  body('name').notEmpty().withMessage('Product name required'),
  body('variants').isArray({ min: 1 }).withMessage('At least one variant required'),
  body('category').optional().isString().withMessage('Category must be a string')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    // Validate variants
    for (const v of req.body.variants) {
      if (!v.size || !v.price || v.price <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Each variant must have size and positive price'
        });
      }
    }

    // Validate category (if provided)
    const category = req.body.category || 'beer';
    const isValid = await isValidCategory(category);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: `Category "${category}" does not exist. Please use an existing category or create one first.`
      });
    }

    const product = { ...req.body, created_at: new Date(), updated_at: new Date() };
    const result = await db.collection('products').insertOne(product);

    clearProductCache();
    clearStatsCache();

    res.json({ success: true, product: { _id: result.insertedId, ...product } });
  } catch (err) {
    console.error('Error creating product:', err);
    res.status(500).json({ success: false, message: 'Failed to create product' });
  }
});

// ==================== UPDATE PRODUCT ====================
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const { id } = req.params;
    const updateData = { ...req.body, updated_at: new Date() };

    // Validate variants
    if (updateData.variants) {
      if (!Array.isArray(updateData.variants) || updateData.variants.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Variants must be a non-empty array'
        });
      }
      for (const v of updateData.variants) {
        if (!v.size || !v.price || v.price <= 0) {
          return res.status(400).json({
            success: false,
            message: 'Each variant must have size and positive price'
          });
        }
      }
    }

    // Validate category (if being updated)
    if (updateData.category) {
      const isValid = await isValidCategory(updateData.category);
      if (!isValid) {
        return res.status(400).json({
          success: false,
          message: `Category "${updateData.category}" does not exist. Please use an existing category or create one first.`
        });
      }
    }

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    const result = await db.collection('products').updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    clearProductCache();
    clearProductCacheById(id);
    clearStatsCache();

    res.json({ success: true });
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ success: false, message: 'Failed to update product' });
  }
});

// ==================== DELETE PRODUCT ====================
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    const result = await db.collection('products').deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    clearProductCache();
    clearProductCacheById(id);
    clearStatsCache();

    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ success: false, message: 'Failed to delete product' });
  }
});

// ==================== CLEAR ALL PRODUCTS ====================
router.delete('/clear/all', requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const result = await db.collection('products').deleteMany({});

    clearProductCache();
    clearStatsCache();

    res.json({ success: true, deletedCount: result.deletedCount, message: `Deleted ${result.deletedCount} products` });
  } catch (err) {
    console.error('Error clearing products:', err);
    res.status(500).json({ success: false, message: 'Failed to clear products' });
  }
});

// ==================== GET AVAILABLE CATEGORIES (Public) ====================
router.get('/categories/available', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database connecting...' });
    }

    // Get custom categories from database
    const customCategories = await db.collection('categories')
      .find({})
      .sort({ label: 1 })
      .toArray();
    
    // Build response
    const allCategories = [];
    
    // Add built-in categories
    Object.keys(CATEGORIES).forEach(key => {
      allCategories.push({
        key: key,
        label: CATEGORIES[key],
        builtin: true
      });
    });
    
    // Add custom categories
    customCategories.forEach(c => {
      allCategories.push({
        key: c.key,
        label: c.label,
        builtin: false
      });
    });
    
    res.json({ 
      success: true, 
      categories: allCategories 
    });
  } catch (err) {
    console.error('Error fetching available categories:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch categories' 
    });
  }
});

module.exports = router;
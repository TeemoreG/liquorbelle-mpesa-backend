const express = require('express');
const axios = require('axios');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { requireAdmin, requireAdminOrCashier } = require('../middleware/auth');
const { 
  statsCache, 
  productCache, 
  clearProductCache, 
  clearStatsCache 
} = require('../utils/cache');
const { CATEGORIES, CATEGORY_COLORS } = require('../config/constants');

const router = express.Router();

// ==================== CATEGORY STATS ====================
router.get('/category-stats', requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false });

    const cached = statsCache.get('category_stats');
    if (cached) {
      return res.json({ success: true, stats: cached, fromCache: true });
    }

    const products = await db.collection('products').find({}).toArray();
    const stats = {};

    Object.keys(CATEGORIES).forEach(cat => {
      stats[cat] = { count: 0, label: CATEGORIES[cat], color: CATEGORY_COLORS[cat] };
    });

    products.forEach(product => {
      const cat = product.category || 'uncategorized';
      if (stats[cat]) {
        stats[cat].count++;
      } else {
        stats[cat] = { count: 1, label: cat, color: '#6B7280' };
      }
    });

    statsCache.set('category_stats', stats);
    res.json({ success: true, stats });
  } catch (err) {
    console.error('Error fetching category stats:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch category stats' });
  }
});

// ==================== GENERATE REPORT ====================
async function generateReport(period) {
  const db = getDB();
  const now = new Date();
  let startDate;

  switch(period) {
    case 'daily':
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'weekly':
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 7);
      break;
    case 'monthly':
      startDate = new Date(now);
      startDate.setMonth(now.getMonth() - 1);
      break;
    default:
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
  }

  const [totalOrders, revenueResult, deliveredResult] = await Promise.all([
    db.collection('orders').countDocuments({ created_at: { $gte: startDate } }),
    db.collection('orders').aggregate([
      { $match: { created_at: { $gte: startDate }, status: 'delivered' } },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]).toArray(),
    db.collection('orders').aggregate([
      { $match: { created_at: { $gte: startDate }, status: 'delivered' } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }, count: { $sum: 1 }, revenue: { $sum: '$total' } } },
      { $sort: { _id: 1 } }
    ]).toArray()
  ]);

  return {
    period,
    startDate,
    endDate: now,
    totalOrders,
    totalRevenue: revenueResult[0]?.total || 0,
    deliveredCount: deliveredResult.reduce((sum, d) => sum + d.count, 0),
    breakdown: deliveredResult
  };
}

// ==================== DAILY REPORT ====================
router.get('/reports/daily', requireAdminOrCashier, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const cached = statsCache.get('stats_daily');
    if (cached) {
      return res.json({ success: true, report: cached, fromCache: true });
    }

    const report = await generateReport('daily');
    statsCache.set('stats_daily', report);
    res.json({ success: true, report });
  } catch (err) {
    console.error('Error generating daily report:', err);
    res.status(500).json({ success: false, message: 'Failed to generate report' });
  }
});

// ==================== WEEKLY REPORT ====================
router.get('/reports/weekly', requireAdminOrCashier, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const cached = statsCache.get('stats_weekly');
    if (cached) {
      return res.json({ success: true, report: cached, fromCache: true });
    }

    const report = await generateReport('weekly');
    statsCache.set('stats_weekly', report);
    res.json({ success: true, report });
  } catch (err) {
    console.error('Error generating weekly report:', err);
    res.status(500).json({ success: false, message: 'Failed to generate report' });
  }
});

// ==================== MONTHLY REPORT ====================
router.get('/reports/monthly', requireAdminOrCashier, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const cached = statsCache.get('stats_monthly');
    if (cached) {
      return res.json({ success: true, report: cached, fromCache: true });
    }

    const report = await generateReport('monthly');
    statsCache.set('stats_monthly', report);
    res.json({ success: true, report });
  } catch (err) {
    console.error('Error generating monthly report:', err);
    res.status(500).json({ success: false, message: 'Failed to generate report' });
  }
});

// ==================== LEGACY STATS ====================
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const cached = statsCache.get('legacy_stats');
    if (cached) {
      return res.json({ success: true, stats: cached, fromCache: true });
    }

    const [totalOrders, totalProducts, revenueResult, pending, paid, delivered] = await Promise.all([
      db.collection('orders').countDocuments(),
      db.collection('products').countDocuments(),
      db.collection('orders').aggregate([{ $match: { status: 'delivered' } }, { $group: { _id: null, total: { $sum: '$total' } } }]).toArray(),
      db.collection('orders').countDocuments({ status: 'pending' }),
      db.collection('orders').countDocuments({ status: 'paid' }),
      db.collection('orders').countDocuments({ status: 'delivered' })
    ]);

    const stats = {
      totalOrders,
      totalProducts,
      totalRevenue: revenueResult[0]?.total || 0,
      pendingOrders: pending,
      paidOrders: paid,
      deliveredOrders: delivered
    };

    statsCache.set('legacy_stats', stats);
    res.json({ success: true, stats });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});

// ==================== DELIVERY SETTINGS ====================
router.get('/delivery-settings', requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.json({ 
        success: true, 
        settings: { delivery_fee: 150, free_delivery_threshold: 3000, delivery_enabled: true } 
      });
    }

    const settings = await db.collection('settings').findOne({ key: 'delivery' });
    
    res.json({ 
      success: true, 
      settings: settings?.value || { delivery_fee: 150, free_delivery_threshold: 3000, delivery_enabled: true } 
    });
  } catch (err) {
    console.error('Error fetching delivery settings:', err);
    res.json({ 
      success: true, 
      settings: { delivery_fee: 150, free_delivery_threshold: 3000, delivery_enabled: true } 
    });
  }
});

router.post('/delivery-settings', requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const { delivery_fee, free_delivery_threshold, delivery_enabled } = req.body;

    await db.collection('settings').updateOne(
      { key: 'delivery' },
      {
        $set: {
          value: {
            delivery_fee: delivery_fee || 0,
            free_delivery_threshold: free_delivery_threshold || 0,
            delivery_enabled: delivery_enabled !== false
          },
          updated_at: new Date()
        }
      },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Error saving delivery settings:', err);
    res.status(500).json({ success: false, message: 'Failed to update delivery settings' });
  }
});

// ==================== GOOGLE SHEETS IMPORT ====================
const GOOGLE_SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
const GOOGLE_SHEETS_SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

router.post('/import-sheet', requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const { spreadsheetId, range, sheetName } = req.body;
    const sheetId = spreadsheetId || GOOGLE_SHEETS_SPREADSHEET_ID;
    const sheetRange = range || 'Sheet1!A1:Z1000';

    if (!GOOGLE_SHEETS_API_KEY) {
      return res.status(400).json({
        success: false,
        message: 'Google Sheets API key not configured. Set GOOGLE_SHEETS_API_KEY in environment variables.'
      });
    }

    if (!sheetId) {
      return res.status(400).json({
        success: false,
        message: 'Spreadsheet ID required. Provide in request or set GOOGLE_SHEETS_SPREADSHEET_ID.'
      });
    }

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetRange}?key=${GOOGLE_SHEETS_API_KEY}`;
    const response = await axios.get(url, { timeout: 30000 });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return res.status(400).json({ success: false, message: 'No data found in sheet' });
    }

    const headers = rows[0].map(h => h.trim().toLowerCase());
    const imported = [];
    const errors = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = row[j] || '';
      }

      if (!obj.name && !obj['product name']) continue;

      try {
        const product = {
          name: obj.name || obj['product name'] || '',
          category: obj.category || obj['category'] || 'beer',
          badge: obj.badge || obj['badge'] || '',
          image: obj.image || obj['image url'] || obj['image_url'] || '',
          description: obj.description || obj['description'] || '',
          isTrending: (obj.trending || obj['is trending'] || obj['is_trending'] || '').toLowerCase() === 'true' || false,
          isNew: (obj.new || obj['is new'] || obj['is_new'] || '').toLowerCase() === 'true' || false,
          rating: parseFloat(obj.rating || obj['rating'] || 4) || 4,
          variants: []
        };

        for (let k = 1; k <= 10; k++) {
          const sizeKey = 'size' + k;
          const priceKey = 'price' + k;
          const discountKey = 'discount' + k;

          let size = obj[sizeKey] || obj['Size' + k] || obj['SIZE' + k] || '';
          let price = parseFloat(obj[priceKey] || obj['Price' + k] || obj['PRICE' + k] || 0);
          let discount = parseInt(obj[discountKey] || obj['Discount' + k] || obj['DISCOUNT' + k] || 0);

          if (size && price > 0) {
            product.variants.push({ size, price, discount });
          }
        }

        if (product.variants.length === 0) {
          const size = obj.size || obj['Size'] || obj['SIZE'] || '750ml';
          const price = parseFloat(obj.price || obj['Price'] || obj['PRICE'] || 0);
          const discount = parseInt(obj.discount || obj['Discount'] || obj['DISCOUNT'] || 0);
          if (price > 0) {
            product.variants.push({ size, price, discount });
          }
        }

        if (product.variants.length === 0) {
          errors.push(`Row ${i+1}: No variants found for "${product.name}"`);
          continue;
        }

        if (!product.name) {
          errors.push(`Row ${i+1}: Missing product name`);
          continue;
        }

        product.created_at = new Date();
        product.updated_at = new Date();
        const result = await db.collection('products').insertOne(product);
        imported.push({ ...product, _id: result.insertedId });

      } catch (err) {
        errors.push(`Row ${i+1}: ${err.message}`);
      }
    }

    clearProductCache();
    clearStatsCache();

    res.json({
      success: true,
      imported: imported.length,
      errors: errors,
      products: imported,
      message: `Imported ${imported.length} products${errors.length > 0 ? `, ${errors.length} errors` : ''}`
    });

  } catch (err) {
    console.error('Google Sheets import error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to import from Google Sheets: ' + err.message });
  }
});

// ==================== GOOGLE SHEETS EXPORT ====================
router.get('/export-sheet', requireAdmin, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const products = await db.collection('products').find({}).sort({ created_at: -1 }).toArray();

    let csv = 'Name,Category,Badge,Image,Description,Trending,New,Rating';

    let maxVariants = 0;
    products.forEach(p => {
      if (p.variants && p.variants.length > maxVariants) {
        maxVariants = p.variants.length;
      }
    });

    for (let i = 1; i <= maxVariants; i++) {
      csv += `,Size${i},Price${i},Discount${i}`;
    }
    csv += '\n';

    products.forEach(p => {
      let row = `"${(p.name || '').replace(/"/g, '""')}",`;
      row += `"${(p.category || '').replace(/"/g, '""')}",`;
      row += `"${(p.badge || '').replace(/"/g, '""')}",`;
      row += `"${(p.image || '').replace(/"/g, '""')}",`;
      row += `"${(p.description || '').replace(/"/g, '""')}",`;
      row += `${p.isTrending ? 'TRUE' : 'FALSE'},`;
      row += `${p.isNew ? 'TRUE' : 'FALSE'},`;
      row += `${p.rating || 4}`;

      if (p.variants) {
        p.variants.forEach(v => {
          row += `,${v.size},${v.price},${v.discount || 0}`;
        });
        for (let i = p.variants.length; i < maxVariants; i++) {
          row += ',,'; 
        }
      }
      csv += row + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=liquorbelle_products_export.csv');
    res.send(csv);

  } catch (err) {
    console.error('Export error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to export products' });
  }
});

// ==================== SHEET INFO ====================
router.get('/sheet-info', requireAdmin, async (req, res) => {
  try {
    if (!GOOGLE_SHEETS_API_KEY) {
      return res.status(400).json({
        success: false,
        message: 'Google Sheets API key not configured'
      });
    }

    const sheetId = req.query.spreadsheetId || GOOGLE_SHEETS_SPREADSHEET_ID;
    if (!sheetId) {
      return res.status(400).json({
        success: false,
        message: 'Spreadsheet ID required'
      });
    }

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${GOOGLE_SHEETS_API_KEY}`;
    const response = await axios.get(url, { timeout: 10000 });

    const sheets = response.data.sheets.map(s => ({
      name: s.properties.title,
      sheetId: s.properties.sheetId,
      index: s.properties.index
    }));

    res.json({ success: true, sheets });

  } catch (err) {
    console.error('Sheet info error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get sheet info: ' + err.message });
  }
});

module.exports = router;
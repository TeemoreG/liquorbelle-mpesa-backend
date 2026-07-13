const NodeCache = require('node-cache');

const orderCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });
const productCache = new NodeCache({ stdTTL: 300, checkperiod: 600 });
const statsCache = new NodeCache({ stdTTL: 300, checkperiod: 600 });

function clearOrderCache() {
  try {
    const keys = orderCache.keys();
    let deletedCount = 0;
    for (const key of keys) {
      if (key.startsWith('orders_') || key.startsWith('all_orders') || key.startsWith('recent_')) {
        orderCache.del(key);
        deletedCount++;
      }
    }
    console.log(`Order cache cleared: ${deletedCount} keys removed`);
  } catch (err) {
    console.error('Error clearing order cache:', err.message);
  }
}

function clearProductCache() {
  try {
    productCache.del('all_products');
    productCache.del('category_stats');
    const keys = productCache.keys();
    let deletedCount = 0;
    for (const key of keys) {
      if (key.startsWith('product_')) {
        productCache.del(key);
        deletedCount++;
      }
    }
    console.log(`Product cache cleared: ${deletedCount + 2} keys removed`);
  } catch (err) {
    console.error('Error clearing product cache:', err.message);
  }
}

function clearProductCacheById(id) {
  try {
    if (!id) {
      console.warn('clearProductCacheById called without ID');
      return;
    }
    const key = 'product_' + id;
    productCache.del(key);
    console.log(`Product cache cleared for ${key}`);
  } catch (err) {
    console.error('Error clearing product cache by ID:', err.message);
  }
}

function clearStatsCache() {
  try {
    const keys = ['stats_daily', 'stats_weekly', 'stats_monthly', 'legacy_stats', 'category_stats'];
    let deletedCount = 0;
    for (const key of keys) {
      statsCache.del(key);
      deletedCount++;
    }
    console.log(`Stats cache cleared: ${deletedCount} keys removed`);
  } catch (err) {
    console.error('Error clearing stats cache:', err.message);
  }
}

function clearAllCache() {
  try {
    clearOrderCache();
    clearProductCache();
    clearStatsCache();
    console.log('All cache cleared successfully');
  } catch (err) {
    console.error('Error clearing all cache:', err.message);
  }
}

function getCacheStats() {
  return {
    orderCache: {
      keys: orderCache.keys().length,
      ttl: orderCache.options.stdTTL
    },
    productCache: {
      keys: productCache.keys().length,
      ttl: productCache.options.stdTTL
    },
    statsCache: {
      keys: statsCache.keys().length,
      ttl: statsCache.options.stdTTL
    }
  };
}

module.exports = {
  orderCache,
  productCache,
  statsCache,
  clearOrderCache,
  clearProductCache,
  clearProductCacheById,
  clearStatsCache,
  clearAllCache,
  getCacheStats
};
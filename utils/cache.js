const NodeCache = require('node-cache');

const orderCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });
const productCache = new NodeCache({ stdTTL: 300, checkperiod: 600 });
const statsCache = new NodeCache({ stdTTL: 300, checkperiod: 600 });

function clearOrderCache() {
  const keys = orderCache.keys();
  for (const key of keys) {
    if (key.startsWith('orders_') || key.startsWith('all_orders') || key.startsWith('recent_')) {
      orderCache.del(key);
    }
  }
  console.log('Order cache cleared');
}

function clearProductCache() {
  productCache.del('all_products');
  productCache.del('category_stats');
  const keys = productCache.keys();
  for (const key of keys) {
    if (key.startsWith('product_')) {
      productCache.del(key);
    }
  }
  console.log('Product cache cleared');
}

function clearProductCacheById(id) {
  const key = 'product_' + id;
  productCache.del(key);
  console.log(`Product cache cleared for ${key}`);
}

function clearStatsCache() {
  statsCache.del('stats_daily');
  statsCache.del('stats_weekly');
  statsCache.del('stats_monthly');
  statsCache.del('legacy_stats');
  statsCache.del('category_stats');
  console.log('Stats cache cleared');
}

function clearAllCache() {
  clearOrderCache();
  clearProductCache();
  clearStatsCache();
  console.log('All cache cleared');
}

module.exports = {
  orderCache,
  productCache,
  statsCache,
  clearOrderCache,
  clearProductCache,
  clearProductCacheById,
  clearStatsCache,
  clearAllCache
};
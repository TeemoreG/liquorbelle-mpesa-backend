// ==================== CATEGORIES ====================
const CATEGORIES = {
  beer: 'Beer',
  brandy: 'Brandy',
  bourbon: 'Bourbon',
  rum: 'Rum',
  spirits: 'Spirits',
  liqueur: 'Liqueur',
  juice: 'Juice',
  soda: 'Soda',
  water: 'Water',
  energy: 'Energy Drink',
  cigar: 'Cigar',
  accessory: 'Accessory',
  whisky: 'Whisky',
  wine: 'Wine',
  vodka: 'Vodka',
  gin: 'Gin',
  cognac: 'Cognac',
  cream: 'Creams',
  cider: 'Cider',
  vermouth: 'Vermouth'
};

const CATEGORY_COLORS = {
  beer: '#F59E0B',
  brandy: '#B8860B',
  bourbon: '#8B4513',
  rum: '#DC2626',
  spirits: '#7C3AED',
  liqueur: '#EC4899',
  juice: '#EF4444',
  soda: '#3B82F6',
  water: '#06B6D4',
  energy: '#F97316',
  cigar: '#92400E',
  accessory: '#6B7280',
  whisky: '#D4A843',
  wine: '#722F37',
  vodka: '#E8E8E8',
  gin: '#4CAF50',
  cognac: '#8B6914',
  cream: '#F5D0A9',
  cider: '#F59E0B',
  vermouth: '#B8860B'
};

// ==================== SHOP LOCATION ====================
const SHOP_LOCATION = {
  lat: -1.2832,
  lng: 36.7254,
  address: 'Dagoretti Road, Nairobi'
};

// ==================== DELIVERY TIERS ====================
const DELIVERY_TIERS = [
  { minDistance: 0, maxDistance: 5, fee: 150 },
  { minDistance: 5, maxDistance: 10, fee: 180 },
  { minDistance: 10, maxDistance: 15, fee: 220 },
  { minDistance: 15, maxDistance: 20, fee: 280 },
  { minDistance: 20, maxDistance: 30, fee: 350 },
  { minDistance: 30, maxDistance: Infinity, fee: 405 }
];

// ==================== DEFAULTS ====================
const DEFAULT_DELIVERY = {
  fee: 150,
  freeThreshold: 5000,
  enabled: true,
  shop: SHOP_LOCATION,
  tiers: DELIVERY_TIERS
};

const DEFAULT_ORDER_STATUSES = ['pending', 'paid', 'delivered'];

// ==================== HELPERS ====================
function getCategoryLabel(category) {
  return CATEGORIES[category] || category || 'Uncategorized';
}

function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || '#6B7280';
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/;
  return emailRegex.test(email);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function getFeeByDistance(distance) {
  for (const tier of DELIVERY_TIERS) {
    if (distance >= tier.minDistance && distance < tier.maxDistance) {
      return tier.fee;
    }
  }
  return DELIVERY_TIERS[DELIVERY_TIERS.length - 1].fee;
}

module.exports = {
  CATEGORIES,
  CATEGORY_COLORS,
  SHOP_LOCATION,
  DELIVERY_TIERS,
  DEFAULT_DELIVERY,
  DEFAULT_ORDER_STATUSES,
  getCategoryLabel,
  getCategoryColor,
  isValidEmail,
  escapeHtml,
  getFeeByDistance
};
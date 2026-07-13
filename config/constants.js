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
  accessory: 'Accessory'
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
  accessory: '#6B7280'
};

// ==================== DEFAULTS ====================
const DEFAULT_DELIVERY = {
  fee: 100,              // ✅ Changed from 150 to 100
  freeThreshold: 3000,
  enabled: true
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

module.exports = {
  CATEGORIES,
  CATEGORY_COLORS,
  DEFAULT_DELIVERY,
  DEFAULT_ORDER_STATUSES,
  getCategoryLabel,
  getCategoryColor,
  isValidEmail,
  escapeHtml
};
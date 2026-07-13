const bcrypt = require('bcryptjs');
const { getDB } = require('../config/database');

const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DEFAULT_CASHIER_PASSWORD = process.env.CASHIER_PASSWORD || 'cashier1234';

let activeAdminPasswordHash = null;
let activeCashierPasswordHash = null;
let passwordsLoaded = false;

// ==================== FORCE SET DEFAULTS ====================
async function forceSetDefaultPasswords() {
  try {
    const db = getDB();
    if (!db) {
      console.warn('⚠️ Database not available, skipping default password set');
      return;
    }

    const adminHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
    const cashierHash = await bcrypt.hash(DEFAULT_CASHIER_PASSWORD, 10);

    await db.collection('admin_settings').updateOne(
      { key: 'passwords' },
      {
        $set: {
          value: {
            adminPasswordHash: adminHash,
            cashierPasswordHash: cashierHash,
            updated_at: new Date()
          },
          updated_at: new Date()
        }
      },
      { upsert: true }
    );

    activeAdminPasswordHash = adminHash;
    activeCashierPasswordHash = cashierHash;
    passwordsLoaded = true;

    console.log('✅ Default passwords set:');
    console.log(`   👤 Admin: ${DEFAULT_ADMIN_PASSWORD}`);
    console.log(`   🧾 Cashier: ${DEFAULT_CASHIER_PASSWORD}`);
  } catch (err) {
    console.error('❌ Error setting default passwords:', err);
  }
}

// ==================== LOAD PASSWORDS FROM DB ====================
async function loadPasswordsFromDB() {
  try {
    const db = getDB();
    if (!db) {
      console.warn('⚠️ DB not connected, waiting...');
      return false;
    }

    const adminSettings = await db.collection('admin_settings').findOne({ key: 'passwords' });

    if (adminSettings && adminSettings.value && adminSettings.value.adminPasswordHash) {
      activeAdminPasswordHash = adminSettings.value.adminPasswordHash;
      activeCashierPasswordHash = adminSettings.value.cashierPasswordHash;
      passwordsLoaded = true;
      console.log('✅ Loaded password hashes from database');
      return true;
    } else {
      console.log('⚠️ No password hashes found, setting defaults...');
      await forceSetDefaultPasswords();
      return true;
    }
  } catch (err) {
    console.error('❌ Error loading passwords from DB:', err.message);
    await forceSetDefaultPasswords();
    return false;
  }
}

// ==================== GET ACTIVE PASSWORDS ====================
async function getActivePasswords() {
  if (!passwordsLoaded) {
    await loadPasswordsFromDB();
  }
  return {
    adminPasswordHash: activeAdminPasswordHash,
    cashierPasswordHash: activeCashierPasswordHash
  };
}

// ==================== UPDATE PASSWORDS ====================
async function updatePasswords(adminPassword, cashierPassword) {
  const db = getDB();
  if (!db) throw new Error('Database not connected');

  const updateValue = { updated_at: new Date() };

  if (adminPassword !== undefined && adminPassword !== '') {
    if (adminPassword.length < 6) {
      throw new Error('Admin password must be at least 6 characters');
    }
    if (adminPassword.length > 100) {
      throw new Error('Admin password must be less than 100 characters');
    }
    updateValue.adminPasswordHash = await bcrypt.hash(adminPassword, 10);
  }

  if (cashierPassword !== undefined && cashierPassword !== '') {
    if (cashierPassword.length < 6) {
      throw new Error('Cashier password must be at least 6 characters');
    }
    if (cashierPassword.length > 100) {
      throw new Error('Cashier password must be less than 100 characters');
    }
    updateValue.cashierPasswordHash = await bcrypt.hash(cashierPassword, 10);
  }

  if (Object.keys(updateValue).length === 1) {
    throw new Error('At least one password required');
  }

  await db.collection('admin_settings').updateOne(
    { key: 'passwords' },
    { $set: { value: updateValue, updated_at: new Date() } },
    { upsert: true }
  );

  // Reload active passwords
  await loadPasswordsFromDB();

  console.log('✅ Passwords updated successfully');
  return { success: true };
}

// ==================== VERIFY PASSWORD ====================
async function verifyPassword(password, type) {
  if (!password) {
    console.warn('⚠️ Empty password provided for verification');
    return false;
  }

  try {
    const activePasswords = await getActivePasswords();

    if (type === 'admin') {
      if (!activePasswords.adminPasswordHash) {
        console.warn('⚠️ No admin password hash found');
        return false;
      }
      return await bcrypt.compare(password, activePasswords.adminPasswordHash);
    } else if (type === 'cashier') {
      if (!activePasswords.cashierPasswordHash) {
        console.warn('⚠️ No cashier password hash found');
        return false;
      }
      return await bcrypt.compare(password, activePasswords.cashierPasswordHash);
    }

    console.warn(`⚠️ Unknown password type: ${type}`);
    return false;
  } catch (err) {
    console.error('❌ Password verification error:', err.message);
    return false;
  }
}

// ==================== CHECK IF ADMIN PASSWORD EXISTS ====================
async function hasAdminPassword() {
  try {
    const db = getDB();
    if (!db) return false;

    const settings = await db.collection('admin_settings').findOne({ key: 'passwords' });
    return !!(settings?.value?.adminPasswordHash);
  } catch (err) {
    console.error('❌ Error checking admin password:', err.message);
    return false;
  }
}

// ==================== CHECK IF CASHIER PASSWORD EXISTS ====================
async function hasCashierPassword() {
  try {
    const db = getDB();
    if (!db) return false;

    const settings = await db.collection('admin_settings').findOne({ key: 'passwords' });
    return !!(settings?.value?.cashierPasswordHash);
  } catch (err) {
    console.error('❌ Error checking cashier password:', err.message);
    return false;
  }
}

module.exports = {
  loadPasswordsFromDB,
  getActivePasswords,
  updatePasswords,
  verifyPassword,
  hasAdminPassword,
  hasCashierPassword,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_CASHIER_PASSWORD
};
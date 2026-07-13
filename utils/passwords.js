const bcrypt = require('bcryptjs');
const { getDB } = require('../config/database');

const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DEFAULT_CASHIER_PASSWORD = process.env.CASHIER_PASSWORD || 'cashier1234';

let activeAdminPasswordHash = null;
let activeCashierPasswordHash = null;
let passwordsLoaded = false;

async function forceSetDefaultPasswords() {
  try {
    const db = getDB();
    if (!db) return;

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

    console.log('Default passwords set:');
    console.log(`   Admin: ${DEFAULT_ADMIN_PASSWORD}`);
    console.log(`   Cashier: ${DEFAULT_CASHIER_PASSWORD}`);
  } catch (err) {
    console.error('Error setting default passwords:', err);
  }
}

async function loadPasswordsFromDB() {
  try {
    const db = getDB();
    if (!db) {
      console.log('DB not connected, waiting...');
      return false;
    }

    const adminSettings = await db.collection('admin_settings').findOne({ key: 'passwords' });

    if (adminSettings && adminSettings.value && adminSettings.value.adminPasswordHash) {
      activeAdminPasswordHash = adminSettings.value.adminPasswordHash;
      activeCashierPasswordHash = adminSettings.value.cashierPasswordHash;
      console.log('Loaded password hashes from database');
      passwordsLoaded = true;
      return true;
    } else {
      await forceSetDefaultPasswords();
      return true;
    }
  } catch (err) {
    console.error('Error loading passwords from DB:', err.message);
    await forceSetDefaultPasswords();
    return false;
  }
}

async function getActivePasswords() {
  if (!passwordsLoaded) {
    await loadPasswordsFromDB();
  }
  return {
    adminPasswordHash: activeAdminPasswordHash,
    cashierPasswordHash: activeCashierPasswordHash
  };
}

async function updatePasswords(adminPassword, cashierPassword) {
  const db = getDB();
  if (!db) throw new Error('Database not connected');

  const updateValue = { updated_at: new Date() };

  if (adminPassword !== undefined && adminPassword !== '') {
    if (adminPassword.length < 6) {
      throw new Error('Admin password must be at least 6 characters');
    }
    updateValue.adminPasswordHash = await bcrypt.hash(adminPassword, 10);
  }

  if (cashierPassword !== undefined && cashierPassword !== '') {
    if (cashierPassword.length < 6) {
      throw new Error('Cashier password must be at least 6 characters');
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

  return { success: true };
}

async function verifyPassword(password, type) {
  const activePasswords = await getActivePasswords();

  if (type === 'admin') {
    return activePasswords.adminPasswordHash && await bcrypt.compare(password, activePasswords.adminPasswordHash);
  } else if (type === 'cashier') {
    return activePasswords.cashierPasswordHash && await bcrypt.compare(password, activePasswords.cashierPasswordHash);
  }

  return false;
}

module.exports = {
  loadPasswordsFromDB,
  getActivePasswords,
  updatePasswords,
  verifyPassword,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_CASHIER_PASSWORD
};
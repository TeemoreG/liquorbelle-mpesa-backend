const { MongoClient } = require('mongodb');

let db;
let client;

async function connectDB() {
  try {
    const MONGODB_URI = process.env.MONGODB_URI;
    if (!MONGODB_URI) {
      console.error('MONGODB_URI env var not set');
      process.exit(1);
    }

    client = new MongoClient(MONGODB_URI, {
      tls: true,
      tlsAllowInvalidCertificates: false,
      family: 4,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
      minPoolSize: 2,
      maxIdleTimeMS: 30000,
    });

    await client.connect();
    db = client.db('liquorbelle');
    console.log('MongoDB connected');

    // Indexes
    await db.collection('products').createIndex({ name: 1 });
    await db.collection('products').createIndex({ category: 1 });
    await db.collection('orders').createIndex({ customer_email: 1 });
    await db.collection('orders').createIndex({ created_at: -1 });
    await db.collection('orders').createIndex({ status: 1 });
    await db.collection('settings').createIndex({ key: 1 });
    await db.collection('admin_settings').createIndex({ key: 1 });
    await db.collection('pending_orders').createIndex({ created_at: 1 }, { expireAfterSeconds: 3600 });
    await db.collection('otps').createIndex({ created_at: 1 }, { expireAfterSeconds: 600 });
    await db.collection('customers').createIndex({ email: 1 }, { unique: true });

    // Auto-clean pending orders every 30s
    setInterval(async () => {
      try {
        if (!db) return;
        const cutoffTime = new Date(Date.now() - 35000);
        const result = await db.collection('pending_orders').deleteMany({
          paid: false,
          created_at: { $lt: cutoffTime }
        });
        if (result.deletedCount > 0) {
          console.log(`Cleaned ${result.deletedCount} unpaid pending orders`);
        }
      } catch (err) {}
    }, 30000);

    return db;
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    console.log('Retrying in 5 seconds...');
    setTimeout(connectDB, 5000);
  }
}

function getDB() {
  return db;
}

function getClient() {
  return client;
}

async function closeDB() {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
  }
}

module.exports = { connectDB, getDB, getClient, closeDB };
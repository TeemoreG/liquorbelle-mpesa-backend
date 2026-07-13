// scripts/create-admin.js
const { MongoClient } = require('mongodb');

// Your MongoDB URI from .env
const MONGODB_URI = 'mongodb+srv://timblax0_db_user:wyG83thPGsv1DUfO@liquorbelle.mcct7iq.mongodb.net/liquorbelle?retryWrites=true&w=majority';

async function createAdmin() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    console.log('🔄 Connecting to MongoDB...');
    await client.connect();
    
    const db = client.db('liquorbelle');
    const collection = db.collection('admin_settings');
    
    // Hash for password: "admin123"
    const hashedPassword = '$2a$10$r0VK0pH9NtMqJZvXGQVqI.3uZ1tLxCrDPKpRqXtwWYGw1QzUx3oFi';
    
    const result = await collection.updateOne(
      { key: 'admin_credentials' },
      { 
        $set: { 
          key: 'admin_credentials',
          password: hashedPassword,
          created_at: new Date(),
          updated_at: new Date()
        }
      },
      { upsert: true }
    );
    
    if (result.upsertedCount > 0) {
      console.log('✅ Admin created successfully!');
    } else if (result.modifiedCount > 0) {
      console.log('✅ Admin updated successfully!');
    } else {
      console.log('ℹ️ Admin already exists with correct password.');
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔑 Password: admin123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.close();
    console.log('\n✅ Done!');
  }
}

createAdmin();
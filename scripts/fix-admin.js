const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const uri = 'mongodb+srv://timblax0_db_user:wyG83thPGsv1DUfO@liquorbelle.mcct7iq.mongodb.net/liquorbelle?retryWrites=true&w=majority';

async function fixAdmin() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('liquorbelle');
    
    // Use the new hash from check-admin.js
    const newHash = '$2a$10$gDcjtJf3CDMEi/fmXMn.C.vYZuP69aqjy6yxZ31MEpPLZUvBWhk0O';
    
    // Update the database
    const result = await db.collection('admin_settings').updateOne(
      { key: 'admin_credentials' },
      { 
        $set: { 
          password: newHash,
          updated_at: new Date()
        }
      },
      { upsert: true }
    );
    
    console.log('Update result:', result);
    
    // Verify
    const admin = await db.collection('admin_settings').findOne({ key: 'admin_credentials' });
    const isValid = await bcrypt.compare('admin123', admin.password);
    console.log('\n✅ Verification: Password "admin123" matches?', isValid ? '✅ YES' : '❌ NO');
    
    if (isValid) {
      console.log('\n🎉 Admin password fixed! Now try logging in.');
      console.log('🔑 Password: admin123');
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.close();
  }
}

fixAdmin();
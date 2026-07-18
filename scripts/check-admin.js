const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const uri = 'mongodb+srv://timblax0_db_user:wyG83thPGsv1DUfO@liquorbelle.mcct7iq.mongodb.net/liquorbelle?retryWrites=true&w=majority';

async function checkAdmin() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('liquorbelle');
    const admin = await db.collection('admin_settings').findOne({ key: 'admin_credentials' });
    
    console.log('=== Admin Record ===');
    console.log('Found:', admin ? 'YES' : 'NO');
    if (admin) {
      console.log('Password hash:', admin.password);
      console.log('Hash length:', admin.password ? admin.password.length : 0);
      
      // Test the hash with password "admin123"
      const testPassword = 'admin123';
      const isValid = await bcrypt.compare(testPassword, admin.password);
      console.log('Does "admin123" match this hash?', isValid ? '✅ YES' : '❌ NO');
      
      if (!isValid) {
        console.log('\n⚠️ Hash does NOT match "admin123"');
        console.log('Generating new hash for "admin123"...');
        const newHash = await bcrypt.hash(testPassword, 10);
        console.log('New hash:', newHash);
        console.log('\n💡 Update the database with this hash:');
        console.log(newHash);
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.close();
  }
}

checkAdmin();
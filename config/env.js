// ==================== ENVIRONMENT VALIDATION ====================
const requiredEnvVars = ['MONGODB_URI', 'JWT_SECRET'];

const optionalEnvVars = [
  'BREVO_API_KEY',
  'CONSUMER_KEY',
  'CONSUMER_SECRET',
  'PASSKEY',
  'SHORTCODE',
  'GOOGLE_SHEETS_API_KEY',
  'GOOGLE_SHEETS_SPREADSHEET_ID',
  'MAP_MAKER_API_KEY',
  'ADMIN_PASSWORD',
  'CASHIER_PASSWORD',
  'PORT'
];

function validateEnv() {
  const missing = requiredEnvVars.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('Missing required environment variables:');
    missing.forEach(key => console.error(`  - ${key}`));
    console.error('Please set these in your .env file');
    process.exit(1);
  }

  console.log('All required env vars are set');

  console.log('Optional services:');
  optionalEnvVars.forEach(key => {
    const status = process.env[key] ? 'Configured' : 'Not set';
    console.log(`  ${key}: ${status}`);
  });
}

module.exports = { validateEnv };
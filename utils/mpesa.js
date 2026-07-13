const axios = require('axios');

const CONSUMER_KEY = process.env.CONSUMER_KEY || 'YOUR_CONSUMER_KEY';
const CONSUMER_SECRET = process.env.CONSUMER_SECRET || 'YOUR_CONSUMER_SECRET';
const PASSKEY = process.env.PASSKEY;
const SHORTCODE = process.env.SHORTCODE || '174379';
const baseURL = 'https://sandbox.safaricom.co.ke';

let mpesaAccessToken = null;
let mpesaTokenExpiry = 0;

// ==================== GET M-PESA ACCESS TOKEN ====================
async function getMpesaAccessToken() {
  try {
    if (mpesaAccessToken && Date.now() < mpesaTokenExpiry - 60000) {
      return mpesaAccessToken;
    }

    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');

    const res = await axios.get(`${baseURL}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 10000
    });

    if (!res.data || !res.data.access_token) {
      throw new Error('Invalid response from M-PESA: No access token');
    }

    mpesaAccessToken = res.data.access_token;
    mpesaTokenExpiry = Date.now() + (res.data.expires_in * 1000);

    return mpesaAccessToken;
  } catch (err) {
    console.error('M-PESA token error:', err.response?.data?.message || err.message);
    throw new Error('Failed to get M-PESA access token: ' + (err.response?.data?.message || err.message));
  }
}

// ==================== FORMAT PHONE NUMBER ====================
function formatPhone(phone) {
  try {
    if (!phone) {
      throw new Error('Phone number is required');
    }

    let cleaned = phone.toString().replace(/\D/g, '');

    if (cleaned.length === 10 && (cleaned.startsWith('07') || cleaned.startsWith('01'))) {
      cleaned = '254' + cleaned.slice(1);
    } else if (cleaned.length === 9 && cleaned.startsWith('7')) {
      cleaned = '254' + cleaned;
    } else if (!cleaned.startsWith('254')) {
      cleaned = '254' + cleaned;
    }

    if (cleaned.length !== 12) {
      throw new Error(`Invalid phone number length: ${cleaned.length}. Expected 12 digits.`);
    }

    return cleaned;
  } catch (err) {
    console.error('Phone formatting error:', err.message);
    throw new Error('Invalid phone number format: ' + err.message);
  }
}

// ==================== INITIATE STK PUSH ====================
async function initiateSTKPush(phone, amount, orderId, callbackUrl) {
  try {
    if (!phone) throw new Error('Phone number is required');
    if (!amount || amount <= 0) throw new Error('Amount must be greater than 0');
    if (!orderId) throw new Error('Order ID is required');

    const formattedPhone = formatPhone(phone);
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);

    if (!PASSKEY) {
      throw new Error('M-PESA PASSKEY is not configured');
    }

    const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');
    const token = await getMpesaAccessToken();

    const callback = callbackUrl || `https://liquorbelle-mpesa-backend.onrender.com/api/callback`;

    const payload = {
      BusinessShortCode: SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: formattedPhone,
      PartyB: SHORTCODE,
      PhoneNumber: formattedPhone,
      CallBackURL: callback,
      AccountReference: orderId.substring(0, 12),
      TransactionDesc: `LiquorBelle Order ${orderId.substring(0, 6)}`
    };

    const response = await axios.post(`${baseURL}/mpesa/stkpush/v1/processrequest`, payload, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000
    });

    if (!response.data || response.data.ResponseCode !== '0') {
      throw new Error(response.data?.ResponseDescription || 'STK Push initiation failed');
    }

    return response.data;
  } catch (err) {
    console.error('STK Push error:', err.response?.data?.message || err.message);
    throw new Error('Payment initiation failed: ' + (err.response?.data?.message || err.message));
  }
}

// ==================== CHECK M-PESA CONFIGURATION ====================
function isMpesaConfigured() {
  const hasKeys = CONSUMER_KEY && CONSUMER_KEY !== 'YOUR_CONSUMER_KEY';
  const hasSecret = CONSUMER_SECRET && CONSUMER_SECRET !== 'YOUR_CONSUMER_SECRET';
  const hasPasskey = PASSKEY && PASSKEY !== 'YOUR_PASSKEY';
  return !!(hasKeys && hasSecret && hasPasskey);
}

module.exports = {
  getMpesaAccessToken,
  formatPhone,
  initiateSTKPush,
  SHORTCODE,
  baseURL,
  isMpesaConfigured
};
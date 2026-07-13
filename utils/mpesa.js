const axios = require('axios');

const CONSUMER_KEY = process.env.CONSUMER_KEY || 'YOUR_CONSUMER_KEY';
const CONSUMER_SECRET = process.env.CONSUMER_SECRET || 'YOUR_CONSUMER_SECRET';
const PASSKEY = process.env.PASSKEY;
const SHORTCODE = process.env.SHORTCODE || '174379';
const baseURL = 'https://sandbox.safaricom.co.ke';

let mpesaAccessToken = null;
let mpesaTokenExpiry = 0;

async function getMpesaAccessToken() {
  if (mpesaAccessToken && Date.now() < mpesaTokenExpiry - 60000) {
    return mpesaAccessToken;
  }

  try {
    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
    const res = await axios.get(`${baseURL}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 10000
    });
    mpesaAccessToken = res.data.access_token;
    mpesaTokenExpiry = Date.now() + (res.data.expires_in * 1000);
    return mpesaAccessToken;
  } catch (err) {
    console.error('M-PESA token error:', err.message);
    throw new Error('Failed to get M-PESA access token');
  }
}

function formatPhone(phone) {
  let cleaned = phone.toString().replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '254' + cleaned.slice(1);
  if (!cleaned.startsWith('254')) cleaned = '254' + cleaned;
  return cleaned;
}

async function initiateSTKPush(phone, amount, orderId, callbackUrl) {
  const formattedPhone = formatPhone(phone);
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');
  const token = await getMpesaAccessToken();

  const callback = callbackUrl || `https://liquorbelle-mpesa-backend.onrender.com/api/callback`;

  const response = await axios.post(`${baseURL}/mpesa/stkpush/v1/processrequest`, {
    BusinessShortCode: SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: formattedPhone,
    PartyB: SHORTCODE,
    PhoneNumber: formattedPhone,
    CallBackURL: callback,
    AccountReference: orderId,
    TransactionDesc: `LiquorBelle Order ${orderId}`
  }, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000
  });

  return response.data;
}

module.exports = {
  getMpesaAccessToken,
  formatPhone,
  initiateSTKPush,
  SHORTCODE,
  baseURL
};
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ==================== SAFARICOM DARAJA CREDENTIALS ====================
const CONSUMER_KEY = process.env.CONSUMER_KEY || 'YOUR_CONSUMER_KEY';
const CONSUMER_SECRET = process.env.CONSUMER_SECRET || 'YOUR_CONSUMER_SECRET';
const PASSKEY = process.env.PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
const SHORTCODE = process.env.SHORTCODE || '174379';
const BUSINESS_NUMBER = '254748894443';

const baseURL = 'https://sandbox.safaricom.co.ke';

let accessToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry - 60000) return accessToken;
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res = await axios.get(`${baseURL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` }
  });
  accessToken = res.data.access_token;
  tokenExpiry = Date.now() + (res.data.expires_in * 1000);
  return accessToken;
}

function formatPhone(phone) {
  let cleaned = phone.toString().replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '254' + cleaned.slice(1);
  if (!cleaned.startsWith('254')) cleaned = '254' + cleaned;
  return cleaned;
}

const pendingOrders = new Map();

// ==================== STK PUSH ENDPOINT ====================
app.post('/api/stkpush', async (req, res) => {
  try {
    const { phone, amount, orderId, customerName, address, items, subtotal, delivery, total } = req.body;
    const formattedPhone = formatPhone(phone);
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');
    const token = await getAccessToken();

    const payload = {
      BusinessShortCode: SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(total),
      PartyA: formattedPhone,
      PartyB: SHORTCODE,
      PhoneNumber: formattedPhone,
      CallBackURL: `https://liquorbelle-mpesa-backend.onrender.com/api/callback`,
      AccountReference: orderId,
      TransactionDesc: `LiquorBelle Order ${orderId}`
    };

    const response = await axios.post(`${baseURL}/mpesa/stkpush/v1/processrequest`, payload, {
      headers: { Authorization: `Bearer ${token}` }
    });

    pendingOrders.set(orderId, {
      customerName, phone: formattedPhone, address, items, subtotal, delivery, total, orderId
    });

    res.json({ success: true, checkoutRequestID: response.data.CheckoutRequestID });
  } catch (err) {
    console.error('STK Push Error:', err.response?.data || err.message);
    res.status(500).json({ success: false, message: 'Payment initiation failed' });
  }
});

// ==================== M-PESA CALLBACK ENDPOINT ====================
app.post('/api/callback', async (req, res) => {
  const callback = req.body;
  const stkCallback = callback?.Body?.stkCallback;
  if (!stkCallback) return res.json({ ResultCode: 0 });

  const orderId = stkCallback.CallbackMetadata?.Item?.find(i => i.Name === 'AccountReference')?.Value;
  const amount = stkCallback.CallbackMetadata?.Item?.find(i => i.Name === 'Amount')?.Value;

  if (stkCallback.ResultCode === 0) {
    console.log(`✅ Payment successful for order ${orderId}, amount ${amount}`);
    const order = pendingOrders.get(orderId);
    if (order) {
      let msg = `✅ PAYMENT CONFIRMED ✅\n\n`;
      msg += `Order ID: ${order.orderId}\n`;
      msg += `Customer: ${order.customerName}\n`;
      msg += `Phone: ${order.phone}\n`;
      msg += `Address: ${order.address}\n\n`;
      msg += `ITEMS:\n`;
      order.items.forEach(i => { msg += `• ${i.name} x${i.qty} — KES ${(i.price * i.qty).toLocaleString()}\n`; });
      msg += `\nSubtotal: KES ${order.subtotal.toLocaleString()}\n`;
      msg += `Delivery: ${order.delivery === 0 ? 'FREE' : 'KES ' + order.delivery.toLocaleString()}\n`;
      msg += `TOTAL PAID: KES ${order.total.toLocaleString()}\n\n`;
      msg += `📍 Please share your live location now for delivery. 📍\n(📎 → Location → Share Live Location)`;
      pendingOrders.set(orderId, { ...order, paid: true, message: msg });
    }
  } else {
    console.log(`❌ Payment failed: ${stkCallback.ResultDesc}`);
  }
  res.json({ ResultCode: 0 });
});

// ==================== PAYMENT STATUS ENDPOINT ====================
app.get('/api/status/:orderId', (req, res) => {
  const order = pendingOrders.get(req.params.orderId);
  if (order && order.paid) {
    const waLink = `https://wa.me/${BUSINESS_NUMBER}?text=${encodeURIComponent(order.message)}`;
    res.json({ status: 'paid', waLink, message: order.message });
  } else {
    res.json({ status: 'pending' });
  }
});

// ==================== EMAIL OTP (BREVO API - NO SMTP) ====================
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const otpStore = new Map();

app.post('/api/send-email-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email) return res.json({ success: false, message: 'Email required' });
  
  if (!BREVO_API_KEY) {
    console.error('❌ BREVO_API_KEY not configured');
    return res.json({ success: false, message: 'Email service not configured' });
  }
  
  const expiresAt = Date.now() + 10 * 60 * 1000;
  otpStore.set(email, { otp, expiresAt });
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="font-family: 'Plus Jakarta Sans', Arial, sans-serif; background: #0a0a0f; margin: 0; padding: 30px;">
      <div style="max-width: 500px; margin: 0 auto; background: #111118; border-radius: 20px; padding: 30px; border: 1px solid #e03131;">
        <img src="https://i.postimg.cc/PxwLVrdh/227a55e3-ad16-4893-9e87-03dfc202814f.png" alt="LiquorBelle" style="height: 50px; margin-bottom: 20px;">
        <h2 style="color: #e03131; margin-bottom: 15px;">🔐 Your Verification Code</h2>
        <div style="font-size: 42px; font-weight: 800; letter-spacing: 8px; background: #1e1e28; padding: 20px; text-align: center; border-radius: 12px; color: #f0a500;">${otp}</div>
        <p style="color: #6b6780; margin: 20px 0 10px;">This code expires in <strong>10 minutes</strong>.</p>
        <p style="color: #6b6780; font-size: 12px;">If you didn't request this, please ignore this email.</p>
        <hr style="border-color: #1e1e28; margin: 20px 0;">
        <p style="color: #6b6780; font-size: 11px;">LiquorBelle — Dagoretti's Finest</p>
      </div>
    </body>
    </html>
  `;
  
  try {
    const response = await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'LiquorBelle', email: 'timblax0@gmail.com' },
      to: [{ email: email }],
      subject: '🔐 Your LiquorBelle Login Code',
      htmlContent: html
    }, {
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ OTP sent to ${email}`);
    res.json({ success: true, message: 'OTP sent to email' });
  } catch (err) {
    console.error('❌ Brevo API Error:', err.response?.data || err.message);
    res.json({ success: false, message: 'Failed to send email. Please try again.' });
  }
});

app.post('/api/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  const stored = otpStore.get(email);
  
  if (!stored) return res.json({ success: false, message: 'No OTP found. Request a new one.' });
  if (Date.now() > stored.expiresAt) {
    otpStore.delete(email);
    return res.json({ success: false, message: 'OTP expired. Request a new one.' });
  }
  if (stored.otp !== otp) return res.json({ success: false, message: 'Invalid OTP. Try again.' });
  
  otpStore.delete(email);
  res.json({ success: true, message: 'Verification successful' });
});

// ==================== HEALTH CHECK ENDPOINT ====================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    brevoConfigured: !!BREVO_API_KEY,
    message: 'LiquorBelle API is running'
  });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📧 Brevo API Key: ${BREVO_API_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`💳 M-PESA: ${CONSUMER_KEY ? '✅ Configured' : '❌ Missing'}`);
});
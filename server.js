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
    <body style="font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #0a0a0f; margin: 0; padding: 30px;">
      <div style="max-width: 500px; margin: 0 auto; background: linear-gradient(135deg, #111118 0%, #17171f 100%); border-radius: 24px; padding: 32px; border: 1px solid rgba(224, 49, 49, 0.2); box-shadow: 0 20px 40px rgba(0,0,0,0.4);">
        <div style="text-align: center; margin-bottom: 24px;">
          <img src="https://i.postimg.cc/PxwLVrdh/227a55e3-ad16-4893-9e87-03dfc202814f.png" alt="LiquorBelle" style="height: 55px; margin-bottom: 12px;">
          <div style="font-family: 'Sora', sans-serif; font-size: 1.3rem; font-weight: 800; color: #f0eef8;">Liquor<span style="color: #f0a500;">Belle</span></div>
        </div>
        <h2 style="color: #e03131; margin-bottom: 16px; font-size: 24px; font-weight: 700; text-align: center;">Your Verification Code</h2>
        <div style="font-size: 48px; font-weight: 800; letter-spacing: 8px; background: #1e1e28; padding: 24px; text-align: center; border-radius: 16px; color: #f0a500; font-family: monospace; border: 1px solid rgba(240,165,0,0.2);">${otp}</div>
        <p style="color: #9994ad; margin: 24px 0 12px; text-align: center; font-size: 14px;">This code expires in <strong style="color: #f0a500;">10 minutes</strong>.</p>
        <p style="color: #6b6780; font-size: 12px; text-align: center;">If you didn't request this, please ignore this email.</p>
        <hr style="border-color: rgba(255,255,255,0.06); margin: 24px 0;">
        <p style="color: #6b6780; font-size: 11px; text-align: center;">LiquorBelle — Dagoretti's Finest | 24/7 Delivery | Over 18 only</p>
      </div>
    </body>
    </html>
  `;
  
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'LiquorBelle', email: 'timblax0@gmail.com' },
      to: [{ email: email }],
      subject: 'Your LiquorBelle Login Code',
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

// ==================== ORDER CONFIRMATION EMAIL (PREMIUM TEMPLATE) ====================
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

app.post('/api/send-order-email', async (req, res) => {
  const { email, orderId, customerName, phone, items, subtotal, delivery, total, address, timestamp, paymentMethod } = req.body;
  
  if (!email || !orderId) {
    return res.json({ success: false, message: 'Missing required fields' });
  }
  
  if (!BREVO_API_KEY) {
    console.error('❌ BREVO_API_KEY not configured');
    return res.json({ success: false, message: 'Email service not configured' });
  }
  
  // Build items table HTML
  const itemsHtml = items.map(item => `
    <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
      <td style="padding: 14px 12px; color: #c8c4d8; font-size: 14px;">${escapeHtml(item.name)} <span style="color: #6b6780; font-size: 12px;">x ${item.qty}</span></td>
      <td style="padding: 14px 12px; text-align: right; color: #f0a500; font-weight: 600; font-size: 14px;">KES ${(item.price * item.qty).toLocaleString()}</td>
    </tr>
  `).join('');
  
  const deliveryText = delivery === 0 ? 'FREE' : `KES ${delivery.toLocaleString()}`;
  const paymentText = paymentMethod === 'mpesa' ? 'M PESA (STK Push)' : 'Cash on Delivery';
  const formattedPhone = phone ? escapeHtml(phone) : 'Provided at checkout';
  const statusBadge = paymentMethod === 'mpesa' ? 'Payment Confirmed' : 'Order Received';
  const badgeColor = paymentMethod === 'mpesa' ? '#2ecc71' : '#f0a500';
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Order Confirmation - LiquorBelle</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Sora:wght@500;600;700;800&display=swap');
      </style>
    </head>
    <body style="font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #0a0a0f; margin: 0; padding: 0; color: #f0eef8;">
      <div style="max-width: 580px; margin: 0 auto; padding: 40px 20px;">
        <!-- Main Card -->
        <div style="background: linear-gradient(135deg, #111118 0%, #17171f 100%); border-radius: 28px; padding: 32px; border: 1px solid rgba(224, 49, 49, 0.2); box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
          
          <!-- Header with Logo -->
          <div style="text-align: center; margin-bottom: 28px;">
            <img src="https://i.postimg.cc/PxwLVrdh/227a55e3-ad16-4893-9e87-03dfc202814f.png" alt="LiquorBelle" style="height: 55px; margin-bottom: 16px;">
            <div style="font-family: 'Sora', sans-serif; font-size: 1.4rem; font-weight: 800; color: #f0eef8;">Liquor<span style="color: #f0a500;">Belle</span></div>
          </div>
          
          <!-- Status Badge -->
          <div style="text-align: center; margin-bottom: 24px;">
            <span style="display: inline-block; background: ${badgeColor}15; color: ${badgeColor}; padding: 8px 20px; border-radius: 50px; font-size: 13px; font-weight: 700; border: 1px solid ${badgeColor}30;">${statusBadge}</span>
          </div>
          
          <!-- Greeting -->
          <div style="margin-bottom: 24px;">
            <h2 style="font-size: 22px; font-weight: 700; margin-bottom: 8px; color: #f0eef8;">Hello ${escapeHtml(customerName)},</h2>
            <p style="color: #9994ad; font-size: 14px; line-height: 1.5;">Thank you for shopping with LiquorBelle. Your order has been ${paymentMethod === 'mpesa' ? 'successfully paid for and' : 'received and'} is being prepared for delivery.</p>
          </div>
          
          <!-- Order Info Card -->
          <div style="background: #1e1e28; border-radius: 20px; padding: 20px; margin-bottom: 24px; border: 1px solid rgba(255,255,255,0.05);">
            <div style="display: flex; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
              <div>
                <div style="font-size: 11px; color: #6b6780; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">Order Number</div>
                <div style="font-size: 14px; font-weight: 600; color: #f0a500; font-family: monospace;">${orderId}</div>
              </div>
              <div>
                <div style="font-size: 11px; color: #6b6780; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">Order Date</div>
                <div style="font-size: 14px; font-weight: 500; color: #c8c4d8;">${timestamp}</div>
              </div>
              <div>
                <div style="font-size: 11px; color: #6b6780; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">Payment Method</div>
                <div style="font-size: 14px; font-weight: 500; color: #c8c4d8;">${paymentText}</div>
              </div>
            </div>
            
            <div style="border-top: 1px solid rgba(255,255,255,0.06); padding-top: 16px;">
              <div style="font-size: 11px; color: #6b6780; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Delivery Address</div>
              <div style="font-size: 14px; color: #c8c4d8; line-height: 1.4;">${escapeHtml(address)}</div>
            </div>
          </div>
          
          <!-- Items Table -->
          <div style="background: #1e1e28; border-radius: 20px; overflow: hidden; margin-bottom: 24px; border: 1px solid rgba(255,255,255,0.05);">
            <div style="background: #24242f; padding: 14px 20px; font-size: 13px; font-weight: 700; color: #f0a500; text-transform: uppercase; letter-spacing: 1px;">Order Summary</div>
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
                  <th style="padding: 14px 12px; text-align: left; font-size: 11px; color: #6b6780; font-weight: 600;">Item</th>
                  <th style="padding: 14px 12px; text-align: right; font-size: 11px; color: #6b6780; font-weight: 600;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
             </table>
          </div>
          
          <!-- Totals -->
          <div style="background: #1e1e28; border-radius: 20px; padding: 20px; margin-bottom: 24px; border: 1px solid rgba(255,255,255,0.05);">
            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
              <span style="color: #9994ad; font-size: 14px;">Subtotal</span>
              <span style="color: #c8c4d8; font-size: 14px; font-weight: 500;">KES ${subtotal.toLocaleString()}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
              <span style="color: #9994ad; font-size: 14px;">Delivery Fee</span>
              <span style="color: #c8c4d8; font-size: 14px; font-weight: 500;">${deliveryText}</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding-top: 16px; margin-top: 8px; border-top: 2px solid #e03131;">
              <span style="font-size: 18px; font-weight: 800; color: #e03131;">Total Amount</span>
              <span style="font-size: 20px; font-weight: 800; color: #e03131;">KES ${total.toLocaleString()}</span>
            </div>
          </div>
          
          <!-- Delivery Note -->
          <div style="background: linear-gradient(135deg, rgba(46,204,113,0.08), rgba(46,204,113,0.02)); border-radius: 20px; padding: 20px; text-align: center; border: 1px solid rgba(46,204,113,0.15); margin-bottom: 24px;">
            <div style="font-size: 32px; margin-bottom: 8px;">🚚</div>
            <div style="font-size: 15px; font-weight: 700; color: #2ecc71; margin-bottom: 6px;">Delivery in Progress</div>
            <div style="font-size: 13px; color: #9994ad;">Our rider will contact you on <strong style="color: #f0a500;">${formattedPhone}</strong> within 45 minutes</div>
          </div>
          
          <!-- Support Section -->
          <div style="background: rgba(224, 49, 49, 0.05); border-radius: 20px; padding: 16px 20px; text-align: center; border: 1px solid rgba(224, 49, 49, 0.1);">
            <div style="font-size: 13px; color: #c8c4d8;">Need help with your order?</div>
            <div style="margin-top: 12px;">
              <a href="https://wa.me/254748894443" style="display: inline-block; background: #25D366; color: #fff; text-decoration: none; padding: 10px 24px; border-radius: 50px; font-size: 13px; font-weight: 700; margin: 0 6px;">WhatsApp Support</a>
              <a href="mailto:support@liquorbelle.co.ke" style="display: inline-block; background: transparent; border: 1px solid rgba(255,255,255,0.2); color: #c8c4d8; text-decoration: none; padding: 10px 24px; border-radius: 50px; font-size: 13px; font-weight: 700; margin: 0 6px;">Email Us</a>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="text-align: center; margin-top: 28px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.05);">
            <p style="font-size: 11px; color: #6b6780; margin-bottom: 6px;">LiquorBelle — Dagoretti's Finest</p>
            <p style="font-size: 10px; color: #6b6780;">24/7 Delivery | Over 18 only | Drink responsibly</p>
            <p style="font-size: 10px; color: #6b6780; margin-top: 12px;">© 2026 LiquorBelle. All rights reserved.</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
  
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'LiquorBelle', email: 'timblax0@gmail.com' },
      to: [{ email: email }],
      subject: `Order Confirmation ${orderId} - LiquorBelle`,
      htmlContent: html
    }, {
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`📧 Order confirmation email sent to ${email} for order ${orderId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Order email error:', err.response?.data || err.message);
    res.json({ success: false, message: 'Failed to send confirmation email' });
  }
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
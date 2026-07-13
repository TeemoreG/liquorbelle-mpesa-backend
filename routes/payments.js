const express = require('express');
const { getDB } = require('../config/database');
const { stkLimiter } = require('../config/rateLimits');
const { initiateSTKPush } = require('../utils/mpesa');
const { sendMpesaOrderReceivedEmail } = require('../utils/email');
const { clearOrderCache, orderCache } = require('../utils/cache');

const router = express.Router();

// ==================== INITIATE STK PUSH ====================
router.post('/stkpush', stkLimiter, async (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(503).json({ success: false, message: 'Database connecting...' });

    const { phone, orderId, customerName, address, items, subtotal, delivery, total, customerEmail } = req.body;

    if (!phone || !orderId || !total) {
      return res.status(400).json({ success: false, message: 'Phone, orderId, and total required' });
    }

    if (total < 1) {
      return res.status(400).json({ success: false, message: 'Invalid total amount' });
    }

    const callbackUrl = `https://liquorbelle-mpesa-backend.onrender.com/api/callback`;

    await initiateSTKPush(phone, total, orderId, callbackUrl);

    await db.collection('pending_orders').insertOne({
      orderId,
      customerName,
      phone,
      address,
      items,
      subtotal,
      delivery,
      total,
      customerEmail,
      created_at: new Date(),
      paid: false
    });

    res.json({ success: true });
  } catch (err) {
    console.error('STK Push error:', err.message);
    res.status(500).json({ success: false, message: 'Payment request failed: ' + err.message });
  }
});

// ==================== M-PESA CALLBACK ====================
router.post('/callback', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.json({ ResultCode: 0 });
    }

    const stkCallback = req.body?.Body?.stkCallback;
    if (!stkCallback) {
      return res.json({ ResultCode: 0 });
    }

    const orderId = stkCallback.CallbackMetadata?.Item?.find(i => i.Name === 'AccountReference')?.Value;

    if (stkCallback.ResultCode === 0 && orderId) {
      console.log(`Payment successful for order ${orderId}`);

      const pending = await db.collection('pending_orders').findOne({ orderId });

      if (pending) {
        await db.collection('orders').updateOne(
          { order_number: orderId },
          {
            $set: {
              status: 'paid',
              payment_method: 'M-PESA',
              updated_at: new Date()
            }
          },
          { upsert: true }
        );

        await sendMpesaOrderReceivedEmail({
          orderId,
          customerName: pending.customerName,
          items: pending.items,
          subtotal: pending.subtotal,
          delivery: pending.delivery,
          total: pending.total,
          address: pending.address,
          phone: pending.phone,
          customerEmail: pending.customerEmail,
          paymentMethod: 'mpesa'
        });

        await db.collection('pending_orders').updateOne(
          { orderId },
          { $set: { paid: true } }
        );

        clearOrderCache();
        if (pending.customerEmail) {
          orderCache.del('orders_' + pending.customerEmail.toLowerCase());
        }
      }
    } else {
      console.log(`Payment failed for order ${orderId}: ${stkCallback.ResultDesc}`);
    }

    res.json({ ResultCode: 0 });
  } catch (err) {
    console.error('Callback error:', err);
    res.json({ ResultCode: 0 });
  }
});

// ==================== CHECK PAYMENT STATUS ====================
router.get('/status/:orderId', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.json({ status: 'pending' });
    }

    const { orderId } = req.params;

    const pending = await db.collection('pending_orders').findOne({ orderId });
    const order = await db.collection('orders').findOne({ order_number: orderId });

    if (order) {
      res.json({ status: order.status || 'pending' });
    } else if (pending) {
      res.json({ status: pending.paid ? 'paid' : 'pending' });
    } else {
      res.json({ status: 'not_found' });
    }
  } catch (err) {
    res.json({ status: 'pending' });
  }
});

// ==================== SEND ORDER EMAIL ====================
router.post('/send-order-email', async (req, res) => {
  const { email, orderId, customerName, phone, items, subtotal, delivery, total, address, timestamp, paymentMethod } = req.body;

  await sendMpesaOrderReceivedEmail({
    orderId,
    customerName,
    items,
    subtotal,
    delivery,
    total,
    address,
    phone,
    customerEmail: email,
    paymentMethod: paymentMethod || 'mpesa'
  });

  res.json({ success: true });
});

module.exports = router;
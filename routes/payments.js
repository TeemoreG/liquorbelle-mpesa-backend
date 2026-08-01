const express = require('express');
const { body, validationResult } = require('express-validator');
const { getDB } = require('../config/database');
const { stkLimiter } = require('../config/rateLimits');
const { initiateSTKPush, isMpesaConfigured, formatPhone } = require('../utils/mpesa');
const { sendMpesaOrderReceivedEmail } = require('../utils/email');
const { clearOrderCache, orderCache } = require('../utils/cache');

const router = express.Router();

// ==================== INITIATE STK PUSH ====================
router.post('/stkpush', stkLimiter, [
  body('phone').notEmpty().withMessage('Phone number is required'),
  body('orderId').notEmpty().withMessage('Order ID is required'),
  body('total').isNumeric().withMessage('Total must be a number').isFloat({ min: 1 }).withMessage('Amount must be greater than 0'),
  body('customerName').optional().isString(),
  body('customerEmail').optional().isEmail().withMessage('Valid email required'),
  body('address').optional().isString(),
  body('items').optional().isArray()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

    const { 
      phone, 
      orderId, 
      customerName, 
      address, 
      items, 
      subtotal, 
      delivery, 
      total, 
      customerEmail 
    } = req.body;

    // Check if M-PESA is configured
    if (!isMpesaConfigured()) {
      console.error('❌ M-PESA not configured');
      return res.status(500).json({
        success: false,
        message: 'M-PESA payment is not configured. Please use Pay on Delivery.'
      });
    }

    // Format phone number using mpesa.js
    let formattedPhone;
    try {
      formattedPhone = formatPhone(phone);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'Invalid phone number format. Please use a valid Safaricom number.'
      });
    }

    console.log(`📱 Initiating STK Push for order ${orderId}, amount ${total}, phone ${formattedPhone}`);

    // ✅ FIX 1: Use environment variable for callback URL
    const callbackUrl = process.env.MPESA_CALLBACK_URL || 'https://liquorbelle-mpesa-backend.onrender.com/api/callback';

    // Initiate STK Push using mpesa.js
    const result = await initiateSTKPush(formattedPhone, total, orderId, callbackUrl);

    console.log(`✅ STK Push initiated for order ${orderId}:`, result);

    // ✅ FIX 2: Ensure items is always a valid array
    const validatedItems = Array.isArray(items) && items.length > 0 ? items : [];

    // Save pending order
    await db.collection('pending_orders').insertOne({
      orderId,
      customerName: customerName || 'Guest',
      phone: formattedPhone,
      address: address || '',
      items: validatedItems, // ✅ Using validated items
      subtotal: subtotal || 0,
      delivery: delivery || 0,
      total: total,
      customerEmail: customerEmail || '',
      created_at: new Date(),
      paid: false,
      checkoutRequestId: result.CheckoutRequestID,
      merchantRequestId: result.MerchantRequestID
    });

    res.json({
      success: true,
      message: 'STK Push sent successfully. Please check your phone for the M-PESA prompt.',
      data: {
        checkoutRequestId: result.CheckoutRequestID,
        merchantRequestId: result.MerchantRequestID,
        responseCode: result.ResponseCode,
        responseDescription: result.ResponseDescription
      }
    });

  } catch (err) {
    console.error('❌ STK Push error:', err.message);
    
    let errorMessage = 'Payment initiation failed. Please try again.';
    
    if (err.message.includes('phone')) {
      errorMessage = 'Invalid phone number. Please use a valid Safaricom number.';
    } else if (err.message.includes('amount')) {
      errorMessage = 'Invalid amount. Please try again.';
    } else if (err.message.includes('configured')) {
      errorMessage = 'M-PESA is not configured. Please use Pay on Delivery.';
    } else if (err.message.includes('token')) {
      errorMessage = 'M-PESA service is temporarily unavailable. Please try again.';
    } else if (err.message.includes('timeout')) {
      errorMessage = 'M-PESA request timed out. Please try again.';
    }

    res.status(400).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// ==================== M-PESA CALLBACK ====================
router.post('/callback', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      console.error('❌ Database not available for callback');
      return res.status(200).json({ ResultCode: 0 });
    }

    const stkCallback = req.body?.Body?.stkCallback;
    if (!stkCallback) {
      console.log('⚠️ Invalid callback received - no stkCallback');
      return res.status(200).json({ ResultCode: 0 });
    }

    const { 
      ResultCode, 
      ResultDesc, 
      MerchantRequestID, 
      CheckoutRequestID,
      CallbackMetadata 
    } = stkCallback;

    console.log(`📥 M-PESA Callback:`, {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc
    });

    // Get metadata
    let metadata = {};
    if (CallbackMetadata && CallbackMetadata.Item) {
      CallbackMetadata.Item.forEach(item => {
        metadata[item.Name] = item.Value;
      });
    }

    // Find orderId from AccountReference in metadata
    let orderId = metadata.AccountReference || 
                  stkCallback.AccountReference || 
                  'UNKNOWN';

    console.log(`📥 Order ID from callback: ${orderId}`);

    if (ResultCode === 0 && orderId && orderId !== 'UNKNOWN') {
      console.log(`✅ Payment successful for order ${orderId}`);

      // Find pending order
      const pending = await db.collection('pending_orders').findOne({ orderId });

      if (pending) {
        // Update or create order in orders collection
        const amount = metadata.Amount || pending.total || 0;
        const phone = metadata.PhoneNumber || pending.phone || '';

        await db.collection('orders').updateOne(
          { order_number: orderId },
          {
            $set: {
              order_number: orderId,
              customer_name: pending.customerName || 'Guest',
              customer_email: pending.customerEmail || '',
              phone: phone || pending.phone || '',
              address: pending.address || '',
              items: pending.items || [],
              subtotal: pending.subtotal || 0,
              delivery: pending.delivery || 0,
              total: amount || pending.total || 0,
              payment_method: 'M-PESA',
              status: 'paid',
              payment_details: {
                mpesa: {
                  resultCode: ResultCode,
                  resultDesc: ResultDesc,
                  merchantRequestId: MerchantRequestID,
                  checkoutRequestId: CheckoutRequestID,
                  amount: amount,
                  phone: phone,
                  timestamp: new Date()
                }
              },
              created_at: pending.created_at || new Date(),
              updated_at: new Date()
            }
          },
          { upsert: true }
        );

        console.log(`✅ Order ${orderId} created/updated with status 'paid'`);

        // Send confirmation email
        try {
          await sendMpesaOrderReceivedEmail({
            orderId: orderId,
            customerName: pending.customerName || 'Guest',
            customerEmail: pending.customerEmail || '',
            items: pending.items || [],
            subtotal: pending.subtotal || 0,
            delivery: pending.delivery || 0,
            total: pending.total || 0,
            address: pending.address || '',
            phone: pending.phone || '',
            paymentMethod: 'mpesa'
          });
          console.log(`✅ Payment confirmation email sent to ${pending.customerEmail}`);
        } catch (emailErr) {
          console.error('❌ Email error (non-blocking):', emailErr.message);
        }

        // Mark pending order as paid
        await db.collection('pending_orders').updateOne(
          { orderId },
          { 
            $set: { 
              paid: true,
              paid_at: new Date(),
              mpesa_result: {
                resultCode: ResultCode,
                resultDesc: ResultDesc,
                merchantRequestId: MerchantRequestID,
                checkoutRequestId: CheckoutRequestID
              }
            } 
          }
        );

        // Clear cache
        clearOrderCache();
        if (pending.customerEmail) {
          orderCache.del('orders_' + pending.customerEmail.toLowerCase());
        }

        // ✅ FIX 3: Delete pending order to prevent database bloat
        await db.collection('pending_orders').deleteOne({ orderId });

      } else {
        console.log(`⚠️ No pending order found for ${orderId}`);
      }
    } else {
      console.log(`⚠️ Payment failed for order ${orderId}: ${ResultDesc}`);
      
      // Update pending order status
      if (orderId && orderId !== 'UNKNOWN') {
        await db.collection('pending_orders').updateOne(
          { orderId },
          { 
            $set: { 
              paid: false,
              payment_failed: true,
              failed_reason: ResultDesc,
              failed_at: new Date()
            } 
          }
        );
      }
    }

    // Always return 200 to M-PESA
    res.status(200).json({ ResultCode: 0 });

  } catch (err) {
    console.error('❌ Callback error:', err);
    res.status(200).json({ ResultCode: 0 });
  }
});

// ==================== CHECK PAYMENT STATUS ====================
router.get('/status/:orderId', async (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: 'Database connecting...' 
      });
    }

    const { orderId } = req.params;

    // Check in orders collection first
    const order = await db.collection('orders').findOne({ 
      order_number: orderId 
    });

    if (order) {
      return res.json({
        success: true,
        status: order.status || 'pending',
        paid: order.status === 'paid',
        order: order
      });
    }

    // Check in pending orders
    const pending = await db.collection('pending_orders').findOne({ orderId });

    if (pending) {
      return res.json({
        success: true,
        status: pending.paid ? 'paid' : 'pending',
        paid: pending.paid || false,
        pending: true
      });
    }

    res.json({
      success: true,
      status: 'not_found',
      paid: false
    });

  } catch (err) {
    console.error('❌ Status check error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to check payment status'
    });
  }
});

// ==================== CHECK M-PESA STATUS ====================
router.get('/mpesa-status', async (req, res) => {
  try {
    const configured = isMpesaConfigured();
    res.json({
      success: true,
      configured: configured,
      environment: process.env.MPESA_ENV || 'sandbox',
      shortcode: process.env.SHORTCODE || '174379',
      message: configured ? 'M-PESA is configured and ready' : 'M-PESA is not configured'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// ==================== SEND ORDER EMAIL ====================
router.post('/send-order-email', [
  body('email').isEmail().withMessage('Valid email required'),
  body('orderId').notEmpty().withMessage('Order ID required'),
  body('customerName').notEmpty().withMessage('Customer name required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  try {
    const { 
      email, 
      orderId, 
      customerName, 
      phone, 
      items, 
      subtotal, 
      delivery, 
      total, 
      address, 
      timestamp, 
      paymentMethod 
    } = req.body;

    const result = await sendMpesaOrderReceivedEmail({
      orderId,
      customerName,
      customerEmail: email,
      items: items || [],
      subtotal: subtotal || 0,
      delivery: delivery || 0,
      total: total || 0,
      address: address || '',
      phone: phone || '',
      paymentMethod: paymentMethod || 'mpesa'
    });

    if (result.success) {
      res.json({ 
        success: true, 
        message: 'Email sent successfully' 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: result.error || 'Failed to send email' 
      });
    }

  } catch (err) {
    console.error('❌ Send email error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to send email'
    });
  }
});

module.exports = router;
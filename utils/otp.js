// utils/otp.js
const crypto = require('crypto');

/**
 * OTP Configuration
 */
const OTP_CONFIG = {
  LENGTH: 6,
  EXPIRY_MINUTES: 10,
  MAX_ATTEMPTS: 5,
  COOLDOWN_MINUTES: 1
};

/**
 * Generate a secure 6-digit OTP
 * Uses crypto.randomInt for cryptographic security
 * @param {number} length - Length of OTP (default: 6)
 * @returns {string} Numeric OTP
 */
function generateOTP(length = OTP_CONFIG.LENGTH) {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return crypto.randomInt(min, max + 1).toString().padStart(length, '0');
}

/**
 * Generate a 4-digit OTP (for simpler use cases)
 * @returns {string} 4-digit OTP
 */
function generateShortOTP() {
  return crypto.randomInt(1000, 9999).toString();
}

/**
 * Generate a 6-digit OTP with expiry and attempt tracking
 * @param {number} length - OTP length
 * @param {number} expiryMinutes - Expiry time in minutes
 * @returns {Object} OTP object with metadata
 */
function generateOTPWithExpiry(length = OTP_CONFIG.LENGTH, expiryMinutes = OTP_CONFIG.EXPIRY_MINUTES) {
  const otp = generateOTP(length);
  return {
    otp,
    expiresAt: new Date(Date.now() + expiryMinutes * 60 * 1000),
    createdAt: new Date(),
    attempts: 0,
    maxAttempts: OTP_CONFIG.MAX_ATTEMPTS,
    verified: false
  };
}

/**
 * Check if OTP is expired
 * @param {Date|string} createdAt - Creation timestamp
 * @param {number} expiryMinutes - Expiry time in minutes
 * @returns {boolean} True if expired
 */
function isOTPExpired(createdAt, expiryMinutes = OTP_CONFIG.EXPIRY_MINUTES) {
  const age = (Date.now() - new Date(createdAt).getTime()) / 1000 / 60;
  return age > expiryMinutes;
}

/**
 * Check if OTP attempts exceeded
 * @param {number} attempts - Current attempt count
 * @param {number} maxAttempts - Max allowed attempts
 * @returns {boolean} True if max attempts exceeded
 */
function isOTPBlocked(attempts, maxAttempts = OTP_CONFIG.MAX_ATTEMPTS) {
  return attempts >= maxAttempts;
}

/**
 * Generate a secure alphanumeric OTP (for email verification)
 * @param {number} length - Length of OTP (default: 8)
 * @returns {string} Alphanumeric OTP
 */
function generateAlphanumericOTP(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
}

/**
 * Generate OTP for email sending (Brevo integration)
 * @param {string} email - Recipient email
 * @param {string} type - OTP type (register, reset, login)
 * @returns {Object} OTP payload with email template data
 */
function generateOTPForEmail(email, type = 'register') {
  const otpData = generateOTPWithExpiry();
  const templates = {
    register: {
      subject: '🔐 Verify Your LiquorBelle Account',
      template: 'registration-otp',
      title: 'Welcome to LiquorBelle!'
    },
    reset: {
      subject: '🔑 Reset Your LiquorBelle PIN',
      template: 'reset-pin-otp',
      title: 'PIN Reset Request'
    },
    login: {
      subject: '🔐 Login Verification Code',
      template: 'login-otp',
      title: 'Login Verification'
    }
  };

  const template = templates[type] || templates.register;

  return {
    email,
    otp: otpData.otp,
    expiresAt: otpData.expiresAt,
    createdAt: otpData.createdAt,
    subject: template.subject,
    template: template.template,
    title: template.title,
    type
  };
}

/**
 * Format OTP for email HTML (Brevo compatible)
 * @param {Object} otpData - OTP data from generateOTPForEmail
 * @param {string} otpData.otp - The OTP code
 * @param {string} otpData.title - Email title
 * @param {string} otpData.type - OTP type
 * @param {number} expiryMinutes - Expiry time in minutes
 * @returns {string} HTML email content
 */
function formatOTPEmail(otpData, expiryMinutes = OTP_CONFIG.EXPIRY_MINUTES) {
  const { otp, title, type } = otpData;
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', Arial, sans-serif; background: #f9f6f2; margin: 0; padding: 40px 20px; }
        .container { max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
        .logo { text-align: center; margin-bottom: 24px; }
        .logo img { height: 56px; border-radius: 12px; }
        .title { font-size: 24px; font-weight: 800; color: #800000; text-align: center; margin-bottom: 8px; }
        .subtitle { color: #7A7368; text-align: center; font-size: 14px; margin-bottom: 24px; }
        .otp-box { background: #FDF6E3; border: 2px solid #B8860B; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0; }
        .otp-code { font-size: 36px; font-weight: 900; color: #800000; letter-spacing: 8px; font-family: monospace; }
        .otp-expiry { color: #7A7368; font-size: 12px; text-align: center; margin-top: 12px; }
        .divider { border-top: 1px solid #E8E0D8; margin: 24px 0; }
        .footer { text-align: center; font-size: 12px; color: #7A7368; }
        .footer a { color: #B8860B; text-decoration: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">
          <img src="https://res.cloudinary.com/dvqjgbdhp/image/upload/f_auto,q_auto,w_120,c_fit/v1780905905/WhatsApp_Image_2026-06-04_at_3.41.50_PM_saprsh.jpg" alt="LiquorBelle">
        </div>
        <div class="title">${title}</div>
        <div class="subtitle">Use the code below to ${type === 'register' ? 'verify your account' : type === 'reset' ? 'reset your PIN' : 'verify your login'}</div>
        <div class="otp-box">
          <div class="otp-code">${otp}</div>
        </div>
        <div class="otp-expiry">⏰ This code expires in ${expiryMinutes} minutes</div>
        <div class="divider"></div>
        <div class="footer">
          <p>If you didn't request this, please ignore this email.</p>
          <p>© 2026 LiquorBelle — Nairobi's Finest Alcohol Delivery</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generate OTP for Brevo email API
 * @param {string} email - Recipient email
 * @param {string} type - OTP type (register, reset, login)
 * @param {string} name - User's name (optional)
 * @returns {Object} Brevo email payload
 */
function generateBrevoEmailPayload(email, type = 'register', name = 'Customer') {
  const otpData = generateOTPForEmail(email, type);
  const htmlContent = formatOTPEmail(otpData);
  
  return {
    to: [{ email, name }],
    sender: { email: 'noreply@liquorbelle.com', name: 'LiquorBelle' },
    subject: otpData.subject,
    htmlContent,
    params: {
      otp: otpData.otp,
      name,
      type: otpData.type,
      expiryMinutes: OTP_CONFIG.EXPIRY_MINUTES
    }
  };
}

/**
 * Validate OTP with attempt tracking
 * @param {string} providedOtp - OTP provided by user
 * @param {Object} storedOtp - Stored OTP object
 * @returns {Object} Validation result
 */
function validateOTP(providedOtp, storedOtp) {
  const result = {
    valid: false,
    message: '',
    code: ''
  };

  // Check if OTP exists
  if (!storedOtp || !storedOtp.otp) {
    result.message = 'OTP not found';
    result.code = 'NOT_FOUND';
    return result;
  }

  // Check if already verified
  if (storedOtp.verified) {
    result.message = 'OTP already used';
    result.code = 'ALREADY_USED';
    return result;
  }

  // Check if expired
  if (isOTPExpired(storedOtp.createdAt)) {
    result.message = 'OTP has expired';
    result.code = 'EXPIRED';
    return result;
  }

  // Check attempts
  const attempts = storedOtp.attempts || 0;
  if (isOTPBlocked(attempts)) {
    result.message = 'Too many attempts. Please request a new OTP.';
    result.code = 'BLOCKED';
    return result;
  }

  // Check OTP match
  if (String(providedOtp).trim() === String(storedOtp.otp).trim()) {
    result.valid = true;
    result.message = 'OTP verified successfully';
    result.code = 'SUCCESS';
  } else {
    result.message = 'Invalid OTP';
    result.code = 'INVALID';
  }

  return result;
}

module.exports = {
  OTP_CONFIG,
  generateOTP,
  generateShortOTP,
  generateOTPWithExpiry,
  isOTPExpired,
  isOTPBlocked,
  generateAlphanumericOTP,
  generateOTPForEmail,
  formatOTPEmail,
  generateBrevoEmailPayload,
  validateOTP
};
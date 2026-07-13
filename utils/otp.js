// utils/otp.js
const crypto = require('crypto');

/**
 * Generate a secure 6-digit OTP
 * Uses crypto.randomInt for cryptographic security
 */
function generateOTP(length = 6) {
  // Generate a random number between 100000 and 999999 (for 6 digits)
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return crypto.randomInt(min, max + 1).toString();
}

/**
 * Generate a 4-digit OTP (for simpler use cases)
 */
function generateShortOTP() {
  return crypto.randomInt(1000, 9999).toString();
}

/**
 * Generate a 6-digit OTP with expiry timestamp
 */
function generateOTPWithExpiry(length = 6, expiryMinutes = 10) {
  return {
    otp: generateOTP(length),
    expiresAt: new Date(Date.now() + expiryMinutes * 60 * 1000),
    createdAt: new Date()
  };
}

/**
 * Check if OTP is expired
 */
function isOTPExpired(createdAt, expiryMinutes = 10) {
  const age = (Date.now() - new Date(createdAt).getTime()) / 1000 / 60;
  return age > expiryMinutes;
}

/**
 * Generate a secure alphanumeric OTP (for email verification)
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

module.exports = {
  generateOTP,
  generateShortOTP,
  generateOTPWithExpiry,
  isOTPExpired,
  generateAlphanumericOTP
};
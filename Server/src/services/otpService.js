const crypto = require('crypto');

// In-memory OTP store with 10-minute expiry
const otpStore = new Map();

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const OTP_LENGTH = 6;

function generateOTP() {
  let otp = '';
  for (let i = 0; i < OTP_LENGTH; i++) {
    otp += crypto.randomInt(0, 10).toString();
  }
  return otp;
}

function storeOTP(email, otp) {
  const key = email.toLowerCase();
  otpStore.set(key, {
    code: otp,
    expiresAt: Date.now() + OTP_EXPIRY_MS,
    attempts: 0,
  });

  // Auto-cleanup after expiry
  setTimeout(() => {
    const entry = otpStore.get(key);
    if (entry && entry.code === otp) {
      otpStore.delete(key);
    }
  }, OTP_EXPIRY_MS);
}

function verifyOTP(email, code) {
  const key = email.toLowerCase();
  const entry = otpStore.get(key);

  if (!entry) return { valid: false, reason: 'No OTP found. Please request a new one.' };
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(key);
    return { valid: false, reason: 'OTP has expired. Please request a new one.' };
  }
  if (entry.attempts >= 5) {
    otpStore.delete(key);
    return { valid: false, reason: 'Too many attempts. Please request a new OTP.' };
  }

  entry.attempts++;

  if (entry.code !== code) {
    return { valid: false, reason: 'Invalid OTP code.' };
  }

  otpStore.delete(key);
  return { valid: true };
}

function createAndStore(email) {
  const otp = generateOTP();
  storeOTP(email, otp);
  return otp;
}

module.exports = { generateOTP, storeOTP, verifyOTP, createAndStore };

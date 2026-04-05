require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';

// Enforce SESSION_SECRET in production to prevent session hijacking
const sessionSecret = process.env.SESSION_SECRET || 'studylink-dev-secret-change-in-production';
if (nodeEnv === 'production' && sessionSecret === 'studylink-dev-secret-change-in-production') {
  console.error('[FATAL] SESSION_SECRET must be set in production. Exiting.');
  process.exit(1);
}

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv,

  // CORS
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',

  // Google Apps Script endpoints
  gas: {
    sendOtpUrl: process.env.GAS_SEND_OTP_URL,
    sheetsUrl: process.env.GAS_SHEETS_URL,
    authToken: process.env.GAS_AUTH_TOKEN,  // ← NEW: shared secret for GAS auth
  },

  // Session
  session: {
    secret: sessionSecret,
    maxAge: parseInt(process.env.SESSION_MAX_AGE || '86400000', 10), // 24h
  },
};

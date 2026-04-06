// server/src/config.js

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'https://studylink-xi.vercel.app',
  session: {
    secret: process.env.SESSION_SECRET || 'studylink-2025-secret-key',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
  gas: {
    sheetsUrl: process.env.GAS_SHEETS_URL || '',
    sendOtpUrl: process.env.GAS_SEND_OTP_URL || '', // no longer used but kept for safety
  },
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID || '',
    // Railway stores env vars as single-line strings, so \n must be converted back
    privateKey: (process.env.GMAIL_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    fromEmail: process.env.GMAIL_FROM_EMAIL || '',
  },
};

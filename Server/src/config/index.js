require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';

const sessionSecret = process.env.SESSION_SECRET || 'studylink-dev-secret-change-in-production';
if (nodeEnv === 'production' && sessionSecret === 'studylink-dev-secret-change-in-production') {
  console.error('[FATAL] SESSION_SECRET must be set in production. Exiting.');
  process.exit(1);
}

module.exports = {
  port: process.env.PORT,
  nodeEnv,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  session: {
    secret: sessionSecret,
    maxAge: parseInt(process.env.SESSION_MAX_AGE || '86400000', 10),
  },
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID || '',
    privateKey: (process.env.GMAIL_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    fromEmail: process.env.GMAIL_FROM_EMAIL || '',
  },
};
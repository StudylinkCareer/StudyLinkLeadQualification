const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
const { createClient } = require('redis');
const connectRedis = require('connect-redis');
const config = require('./config');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/students');
const documentRoutes = require('./routes/documents');
const qrRoutes = require('./routes/qr');
const errorHandler = require('./middleware/errorHandler');
const staffRoutes = require('./routes/staff');
const notesRoutes = require('./routes/notes');
const lookupRoutes = require('./routes/lookups');
const marketingEventsRoutes = require('./routes/marketingEvents');
const reportsRoutes            = require('./routes/reports');
const referralSourcesRoutes   = require('./routes/referralSources');
const leadEventsRoutes        = require('./routes/leadEvents');
const referenceDataRoutes     = require('./routes/referenceData');
const distributionRoutes      = require('./routes/distribution');
const eventConsoleRoutes      = require('./routes/eventConsole');
const eventDeskRoutes         = require('./routes/eventDesk');
const leadRoutes              = require('./routes/leads');

const app = express();

// Redis session store
let sessionStore;
if (process.env.REDIS_URL) {
  try {
    const RedisStore = connectRedis.RedisStore || connectRedis.default || connectRedis;
    const redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.connect().catch(console.error);
    sessionStore = new RedisStore({ client: redisClient });
    console.log('[SESSION] Using Redis session store');
  } catch (err) {
    console.error('[SESSION] Redis setup failed:', err.message);
  }
} else if (config.nodeEnv !== 'production') {
  // Dev: file-backed store so nodemon restarts don't log staff out.
  // Guarded — if the package isn't installed yet, fall back to MemoryStore
  // rather than crash. Install once with:  npm install session-file-store
  try {
    const FileStore = require('session-file-store')(session);
    const path = require('path');
    sessionStore = new FileStore({
      path: path.join(__dirname, '..', '.sessions'),
      retries: 1,
      ttl: Math.floor((config.session.maxAge || 86400000) / 1000), // seconds
      logFn: () => {},                                              // quiet
    });
    console.log('[SESSION] Using file session store (dev) — survives restarts');
  } catch (err) {
    console.warn('[SESSION] session-file-store not installed — using MemoryStore. Run: npm install session-file-store');
  }
} else {
  console.warn('[SESSION] No REDIS_URL found — using MemoryStore (dev only)');
}

// Middleware
app.use(cors({
  origin: config.corsOrigin,
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));

// Trust reverse proxy (needed for secure cookies on Railway/Render)
if (config.nodeEnv === 'production') {
  app.set('trust proxy', 1);
}

// Session.
app.use(session({
  store: sessionStore,
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: config.session.maxAge,
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
  },
}));

// Routes
app.use('/api', apiRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/lookups', lookupRoutes);
app.use('/api/marketing-events', marketingEventsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/referral-sources', referralSourcesRoutes);
app.use('/api/lead-events', leadEventsRoutes);
app.use('/api/reference-data', referenceDataRoutes);
app.use('/api/distribution', distributionRoutes);
app.use('/api/event-console', eventConsoleRoutes);
app.use('/api/event-desk', eventDeskRoutes);
app.use('/api/leads', leadRoutes);

// Error handling
app.use(errorHandler);

module.exports = app;

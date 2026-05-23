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

const app = express();

// Redis session store
let sessionStore;
if (process.env.REDIS_URL) {
  try {
    const RedisStore = connectRedis.default || connectRedis;
    const redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.connect().catch(console.error);
    sessionStore = new RedisStore({ client: redisClient });
    console.log('[SESSION] Using Redis session store');
  } catch (err) {
    console.error('[SESSION] Redis setup failed:', err.message);
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

// Error handling
app.use(errorHandler);

module.exports = app;

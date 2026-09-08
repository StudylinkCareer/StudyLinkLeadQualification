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
const noteDraftsRoutes = require('./routes/noteDrafts');
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
const cleanupRoutes           = require('./routes/cleanup');
const zaloWebhookRoutes       = require('./routes/zaloWebhook');

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

// Zalo domain-ownership verification for the webhook domain (app
// "QR Event Registration Badge" 943526229180574542). Zalo checks either the
// homepage meta tag or the /zalo_verifier<code>.html file — serve both so
// whichever method the verifier uses, it passes. Same per-app code as the
// slcareerguidance.netlify.app verification.
const ZALO_VERIFY_CODE = 'UCNb6xBLVm1KqVK2rTjI6I-ewXt3tZ12CJOs';
const zaloVerifyHtml =
  `<!DOCTYPE html><html><head><meta name="zalo-platform-site-verification" content="${ZALO_VERIFY_CODE}" />` +
  `<title>StudyLink API</title></head><body>StudyLink Lead Qualification API</body></html>`;
app.get('/', (_req, res) => res.type('html').send(zaloVerifyHtml));
app.get(`/zalo_verifier${ZALO_VERIFY_CODE}.html`, (_req, res) => res.type('html').send(zaloVerifyHtml));

// Every /api response is authenticated, per-session, frequently-changing
// data — never something a browser or intermediary should cache. Express
// sets a weak ETag by default, which is normally harmless (conditional GET
// still round-trips to the server), but investigating a live report bug
// (2026-09: Individual Report showing all-zero for one staffer on some
// loads, not others, surviving a hard refresh) this was the one remaining
// unruled-out explanation once the frontend fetch-race fix alone didn't
// resolve it — no explicit Cache-Control anywhere meant a GET response
// could in principle be cached under its exact query string by the browser
// or a proxy in between and replayed for an identical later request,
// including a stale/racy one caught mid-bug before that fix shipped.
// Correct regardless of whether that's this bug's actual cause.
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api', apiRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/note-drafts', noteDraftsRoutes);
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
app.use('/api/cleanup', cleanupRoutes);
app.use('/api/zalo', zaloWebhookRoutes);   // ZNS delivery webhook (unauthenticated; Zalo is the caller)

// Error handling
app.use(errorHandler);

module.exports = app;

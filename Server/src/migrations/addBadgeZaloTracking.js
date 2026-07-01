// Server/src/migrations/addBadgeZaloTracking.js
// ---------------------------------------------------------------------------
// Phase 1 of reliable Zalo badge delivery: record WHAT happened to each send,
// per recipient, so the Event Console roster can show it (no more "fire and
// hope"). Adds four columns to event_attendees (badge_zalo_sent_at already
// exists from addBadgeZaloSentAt.js):
//   badge_zalo_msg_id       TEXT         - Zalo's message id (for delivery lookup / webhook match)
//   badge_zalo_status       TEXT         - 'accepted' | 'failed' | 'delivered'
//   badge_zalo_error        TEXT         - failure reason/detail when status='failed'
//   badge_zalo_delivered_at TIMESTAMPTZ  - set by Phase 2 when Zalo confirms handset delivery
//
// Idempotent (ADD COLUMN IF NOT EXISTS). Safe to re-run.
//   node src/migrations/addBadgeZaloTracking.js                 # dev
//   node src/migrations/addBadgeZaloTracking.js --allow-remote  # PROD
// ---------------------------------------------------------------------------

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const url = process.env.DATABASE_URL || '';
if (!process.argv.includes('--allow-remote') && !(url.includes('localhost') && url.includes('studylink_dev'))) {
  console.error('✗ Refusing to run: DATABASE_URL is not localhost/studylink_dev. Use --allow-remote for a deliberate PROD run.');
  process.exit(1);
}

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      ALTER TABLE event_attendees
        ADD COLUMN IF NOT EXISTS badge_zalo_msg_id       TEXT,
        ADD COLUMN IF NOT EXISTS badge_zalo_status       TEXT,
        ADD COLUMN IF NOT EXISTS badge_zalo_error        TEXT,
        ADD COLUMN IF NOT EXISTS badge_zalo_delivered_at TIMESTAMPTZ
    `);
    await client.query('COMMIT');
    console.log('[migrate] event_attendees Zalo tracking columns added (or already present).');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

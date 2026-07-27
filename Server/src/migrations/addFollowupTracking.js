// Server/src/migrations/addFollowupTracking.js
// ---------------------------------------------------------------------------
// Feature 3 — bulk event follow-up (Zalo survey template 611671 + email backup).
// Records what happened to each follow-up send, per recipient, so the Event
// Console roster can show it and "skip already sent" works — mirroring the
// existing badge_zalo_* / badge_emailed_* tracking. Adds six columns to
// event_attendees:
//   followup_zalo_sent_at  TIMESTAMPTZ - set when the Zalo follow-up is accepted
//   followup_zalo_status   TEXT        - 'accepted' | 'failed'
//   followup_zalo_msg_id   TEXT        - Zalo's message id
//   followup_zalo_error    TEXT        - failure reason/detail when status='failed'
//   followup_emailed_at    TIMESTAMPTZ - set when the email backup is sent
//   followup_emailed_to    TEXT        - the address it went to
//
// Idempotent (ADD COLUMN IF NOT EXISTS). Safe to re-run.
//   node src/migrations/addFollowupTracking.js                 # dev
//   node src/migrations/addFollowupTracking.js --allow-remote  # PROD
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
        ADD COLUMN IF NOT EXISTS followup_zalo_sent_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS followup_zalo_status  TEXT,
        ADD COLUMN IF NOT EXISTS followup_zalo_msg_id  TEXT,
        ADD COLUMN IF NOT EXISTS followup_zalo_error   TEXT,
        ADD COLUMN IF NOT EXISTS followup_emailed_at   TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS followup_emailed_to   TEXT
    `);
    await client.query('COMMIT');
    console.log('[migrate] event_attendees follow-up tracking columns added (or already present).');
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

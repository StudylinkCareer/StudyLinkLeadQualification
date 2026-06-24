// server/src/migrations/addBadgeZaloSentAt.js
// Run once: node src/migrations/addBadgeZaloSentAt.js
//
// Adds one column to event_attendees to record when a registration badge was
// delivered via Zalo (mirror of the existing badge_emailed_at):
//   badge_zalo_sent_at  TIMESTAMPTZ  - set when the Zalo badge send succeeds.

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotent: safe to run more than once.
    await client.query(`
      ALTER TABLE event_attendees
        ADD COLUMN IF NOT EXISTS badge_zalo_sent_at TIMESTAMPTZ
    `);

    await client.query('COMMIT');
    console.log('[migrate] event_attendees.badge_zalo_sent_at added (or already present).');
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

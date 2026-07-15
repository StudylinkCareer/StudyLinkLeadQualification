// Server/src/migrations/addStoneResultColumns.js
// ---------------------------------------------------------------------------
// Questionnaire-evaluation (stone) delivery stamps on event_attendees.
// Mirrors the badge_* columns: when the "Know you better" questionnaire is
// submitted, the server e-mails + Zalos the student their stone evaluation and
// stamps the outcome here so the console can see what went out.
//
// Non-destructive: ADD COLUMN IF NOT EXISTS. Idempotent.
//   node src/migrations/addStoneResultColumns.js                 # dev
//   node src/migrations/addStoneResultColumns.js --allow-remote  # PROD
// ---------------------------------------------------------------------------
require('dotenv').config();
const { Pool } = require('pg');

const ARGS = process.argv.slice(2);
const ALLOW_REMOTE = ARGS.includes('--allow-remote');
const url = process.env.DATABASE_URL || '';
const host = (url.match(/@([^:@/]+)/) || [])[1] || '(?)';
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
if (!isLocal && !ALLOW_REMOTE) {
  console.error(`ABORT: non-local host "${host}". Use --allow-remote for a deliberate PROD run.`);
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      ALTER TABLE event_attendees
        ADD COLUMN IF NOT EXISTS result_emailed_at   timestamptz,
        ADD COLUMN IF NOT EXISTS result_emailed_to   text,
        ADD COLUMN IF NOT EXISTS result_zalo_sent_at timestamptz,
        ADD COLUMN IF NOT EXISTS result_zalo_status  text,
        ADD COLUMN IF NOT EXISTS result_zalo_msg_id  text,
        ADD COLUMN IF NOT EXISTS result_zalo_error   text
    `);
    console.log('ensured event_attendees result_* columns');
    await client.query('COMMIT');
    console.log(`✓ COMMITTED on ${host}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('✗ rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();

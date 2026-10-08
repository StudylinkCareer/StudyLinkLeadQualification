// Server/src/migrations/addDeskVisitNoteText.js
// ---------------------------------------------------------------------------
// Adds event_desk_visits.note_text — each booth visit's own note text, so the
// desk scanner can show a student's full consultation history for the day
// (every booth, every rep) without parsing the consolidated per-event note.
// The desk code detects the column, so this can run before or after deploy;
// visits saved before it runs simply show without their text.
//
// Idempotent (ADD COLUMN IF NOT EXISTS). Safe to re-run.
//   node src/migrations/addDeskVisitNoteText.js                 # dev
//   node src/migrations/addDeskVisitNoteText.js --allow-remote  # PROD
// ---------------------------------------------------------------------------
require('dotenv').config();
const { Pool } = require('pg');

const ALLOW_REMOTE = process.argv.includes('--allow-remote');
const url = process.env.DATABASE_URL || '';
const host = (url.match(/@([^:@/]+)/) || [])[1] || '(?)';
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
if (!isLocal && !ALLOW_REMOTE) {
  console.error(`ABORT: non-local host "${host}". Use --allow-remote for a deliberate PROD run.`);
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

(async () => {
  try {
    await pool.query(`ALTER TABLE event_desk_visits ADD COLUMN IF NOT EXISTS note_text text`);
    console.log(`✓ event_desk_visits.note_text ensured on ${host}`);
  } catch (e) {
    console.error('✗ failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

// Server/src/migrations/createEventReps.js
// ---------------------------------------------------------------------------
// Rep-to-event LINK table. A rep is now a link between an EXISTING staff row and
// an event (carrying the kiosk sign-in token + PIN + validity + desk), instead of
// a duplicate 'evt-…@reps.local' staff row. Adding an existing staff member as a
// rep creates only a link (no new staff row); only genuinely-new recruits get a
// staff row (with a proper logon id).
//
// Non-destructive: CREATE TABLE IF NOT EXISTS. Idempotent.
//   node src/migrations/createEventReps.js                 # dev
//   node src/migrations/createEventReps.js --allow-remote  # PROD
//   node src/migrations/createEventReps.js --reset         # drop table
// ---------------------------------------------------------------------------
require('dotenv').config();
const { Pool } = require('pg');

const ARGS = process.argv.slice(2);
const RESET = ARGS.includes('--reset');
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
    if (RESET) {
      await client.query(`DROP TABLE IF EXISTS event_reps`);
      console.log('dropped event_reps');
    } else {
      await client.query(`
        CREATE TABLE IF NOT EXISTS event_reps (
          id                BIGSERIAL PRIMARY KEY,
          event_id          integer NOT NULL,
          staff_id          integer NOT NULL REFERENCES staff(id),
          position          text,                 -- 'Institution rep' | 'StudyLink event staff'
          institution_id    integer,              -- NULL = roving
          valid_from        timestamptz,
          valid_until       timestamptz,
          event_login_token text NOT NULL UNIQUE,
          event_pin         text NOT NULL,
          is_active         boolean NOT NULL DEFAULT true,
          created_at        timestamptz NOT NULL DEFAULT NOW()
        )`);
      // One active link per (event, staff) — the add-rep dedup relies on this.
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_event_reps_active
        ON event_reps (event_id, staff_id) WHERE is_active`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_event_reps_event ON event_reps (event_id)`);
      console.log('ensured event_reps (+ indexes)');
    }
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

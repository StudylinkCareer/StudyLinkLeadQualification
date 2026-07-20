// Per-event report store: staff upload the generated event/attendance report
// files (Excel, PDF, …) against an event; they're kept as bytea in Postgres
// (files are small — tens of KB). Surfaced in the Event Check-in console's
// "Reports" tab. Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addEventReports.js
//   PROD: node src/migrations/addEventReports.js --allow-remote
require('dotenv').config();
const { Pool } = require('pg');

const url  = process.env.DATABASE_URL || '';
const host = (url.split('@')[1] || '').split('/')[0] || '(unknown)';
const isLocal     = /localhost|127\.0\.0\.1|studylink_dev/.test(url);
const allowRemote = process.argv.includes('--allow-remote');

if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!isLocal && !allowRemote) {
  console.error(`Refusing to run against non-local DB (${host}) without --allow-remote`);
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

(async () => {
  console.log('Target DB host: ' + host);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_reports (
      id          serial PRIMARY KEY,
      event_id    integer NOT NULL,
      file_name   text NOT NULL,
      mime_type   text,
      byte_size   integer,
      data        bytea,
      uploaded_by text,
      uploaded_at timestamptz DEFAULT now(),
      source      text NOT NULL DEFAULT 'uploaded',   -- 'uploaded' | 'generated'
      status      text NOT NULL DEFAULT 'ready',       -- 'ready' | 'generating' | 'failed'
      error       text
    )
  `);
  // Idempotent for the table created before these columns existed.
  await pool.query(`ALTER TABLE event_reports
      ALTER COLUMN data DROP NOT NULL,
      ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'uploaded',
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready',
      ADD COLUMN IF NOT EXISTS error  text`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_reports_event ON event_reports(event_id)`);
  const c = await pool.query(
    `SELECT to_regclass('public.event_reports') AS t`
  );
  console.log('event_reports table present: ' + !!c.rows[0].t);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

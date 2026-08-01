// Per-institution sponsorship breakdown for an event (LM console -> Report ->
// Event Report -> School Sponsors tab), replacing the old single manually-
// typed events.total_sponsorship figure with a real line-item list — one row
// per participating institution's contribution, matching the team's real
// "school sponsor list" spreadsheet tab (country / school / amount+currency /
// exchange rate / converted VND / note / standee provided).
//
// events.total_sponsorship is NOT dropped — it stays as a fallback for events
// that haven't had their sponsor breakdown entered yet (getBudget() computes
// SUM(event_institution_sponsors.amount_vnd) when rows exist, else falls back
// to the old manual figure, so existing numbers don't silently disappear).
//
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addEventInstitutionSponsors.js
//   PROD: node src/migrations/addEventInstitutionSponsors.js --allow-remote
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
    CREATE TABLE IF NOT EXISTS event_institution_sponsors (
      id               serial PRIMARY KEY,
      event_id         integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      institution_id   integer NOT NULL REFERENCES institutions(id),
      amount_original  numeric,
      currency         text,
      exchange_rate    numeric,
      amount_vnd       numeric NOT NULL DEFAULT 0,
      is_free          boolean NOT NULL DEFAULT false,
      standee_provided boolean NOT NULL DEFAULT false,
      note             text,
      created_at       timestamptz DEFAULT now(),
      updated_at       timestamptz DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_institution_sponsors_event ON event_institution_sponsors(event_id)`);

  const check = await pool.query(`SELECT to_regclass('public.event_institution_sponsors') AS sponsors_table`);
  console.log(check.rows[0]);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

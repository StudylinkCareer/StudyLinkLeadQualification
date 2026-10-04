// Staff Off-Days (2026-10, requested via cô Như / Hồng Hà): tracks per-staff
// dates out — vacation/leave, training, meetings — that Counsellors and
// Telesales/Pre-sales targets should be reduced for. This migration only
// adds the tracking table itself (Staff Targets page: pick an employee, add
// each off-day entry); deducting these from the actual target calculations
// (counselorTargetForRange/presalesTargetForRange in rangeReport.js) is a
// deliberately separate, not-yet-built follow-up — confirm the deduction
// rule (does a day off zero that day's target entirely, or something
// finer?) before wiring it into live KPI numbers.
//
// One row per (staff, date) — a staff member can only have one reason logged
// per calendar day; re-adding the same date updates the reason instead of
// erroring (see sourceReclassification-style ON CONFLICT pattern elsewhere).
//
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addStaffOffDays.js
//   PROD: node src/migrations/addStaffOffDays.js --allow-remote
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
    CREATE TABLE IF NOT EXISTS staff_off_days (
      id SERIAL PRIMARY KEY,
      staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      off_date DATE NOT NULL,
      reason_type TEXT NOT NULL DEFAULT 'leave',
      note TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (staff_id, off_date)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_staff_off_days_staff ON staff_off_days (staff_id)`);

  const check = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'staff_off_days'`
  );
  console.log('staff_off_days table present:', check.rows[0].n === 1);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

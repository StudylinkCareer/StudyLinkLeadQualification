// Call Day Targets — makes the per-role, per-weekday call quota (New/Ongoing)
// that Weekly Report's "Calls by day" table uses editable from the Staff
// Targets page, replacing the hardcoded CALL_TARGETS constant that used to
// live in reportController.js (Counselor/Pre-Sales x Mon..Sun x New/Ongoing).
//
// Shape: one row per (role, day_of_week), day_of_week 0=Mon..6=Sun (same
// index convention the old CALL_TARGETS arrays used, and that
// weeklyReport's dayIndexOf() still produces) with both New and Ongoing
// targets on it — a role's whole week is 7 rows, not 14.
//
// Seeded with the exact values the hardcoded constant used to have, so this
// migration changes nothing about what the Weekly Report shows on day one —
// only where the numbers live and whether they're editable.
//
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addCallDayTargets.js
//   PROD: node src/migrations/addCallDayTargets.js --allow-remote
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

// The exact values the old hardcoded CALL_TARGETS constant had (Mon..Sun).
const SEED = {
  Counselor:   { new: [10, 10, 10, 10, 10, 5, 0], ongoing: [5,  5,  5,  5,  5,  2, 0] },
  'Pre-Sales': { new: [15, 15, 15, 15, 15, 7, 0], ongoing: [10, 10, 10, 10, 10, 5, 0] },
};

(async () => {
  console.log('Target DB host: ' + host);

  await pool.query(`CREATE TABLE IF NOT EXISTS call_day_targets (
      role text NOT NULL,
      day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      new_target integer NOT NULL DEFAULT 0 CHECK (new_target >= 0),
      ongoing_target integer NOT NULL DEFAULT 0 CHECK (ongoing_target >= 0),
      updated_by text,
      updated_at timestamp DEFAULT now(),
      PRIMARY KEY (role, day_of_week)
    )`);

  let seeded = 0;
  for (const [role, byMetric] of Object.entries(SEED)) {
    for (let d = 0; d < 7; d++) {
      const r = await pool.query(
        `INSERT INTO call_day_targets (role, day_of_week, new_target, ongoing_target, updated_by)
              VALUES ($1, $2, $3, $4, 'migration:addCallDayTargets')
         ON CONFLICT (role, day_of_week) DO NOTHING
         RETURNING role`,
        [role, d, byMetric.new[d], byMetric.ongoing[d]]
      );
      seeded += r.rowCount;
    }
  }
  console.log(`Seeded ${seeded} (role, day_of_week) rows (0 if already present — idempotent).`);

  const check = await pool.query(`
    SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='call_day_targets') AS table_exists,
           (SELECT COUNT(*) FROM call_day_targets) AS row_count
  `);
  console.log('Expect table_exists=1, row_count=14:', check.rows[0]);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

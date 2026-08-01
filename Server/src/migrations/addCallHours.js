// Monthly Report — manual, per-(presales-staff, month) call-hours entry.
// Mirrors monthly_targets' shape exactly (Server/src/migrations/addMonthlyTargets.js)
// but no roster table is needed: scope to active staff whose position matches
// the same '%pre%sale%' pattern reportController.js's weeklyStaffNames() already
// uses, not target_tracked_staff (that's a counselor-KPI roster for a different
// purpose).
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addCallHours.js
//   PROD: node src/migrations/addCallHours.js --allow-remote
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
    CREATE TABLE IF NOT EXISTS call_hours (
      id          serial PRIMARY KEY,
      staff_id    integer NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      month       date    NOT NULL,
      hours       numeric(6,2) NOT NULL CHECK (hours >= 0),
      updated_by  text,
      updated_at  timestamp DEFAULT now(),
      UNIQUE (staff_id, month)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_call_hours_month ON call_hours (month)`);

  const check = await pool.query(`SELECT to_regclass('public.call_hours') AS call_hours_table`);
  console.log(check.rows[0]);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

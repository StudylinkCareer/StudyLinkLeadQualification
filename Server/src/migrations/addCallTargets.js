// Call Targets — a second admin grid on the Staff Targets page, alongside
// the existing Monthly Targets (contracts) grid, so "Calls KPI" in Monthly
// Report can be a real assignable number per staffer instead of one uniform
// per-weekday formula applied to everyone (see computeMonthlyCallsKpi, which
// this fully replaces).
//
// Mirrors the existing target_tracked_staff / monthly_targets / staff.target
// pattern exactly:
//   staff.call_target(_set_by/_at)  - default/base target, like staff.target
//   call_target_tracked_staff       - who appears on the grid (add/remove)
//   call_targets                    - per-(staff, month) override
//
// Auto-seeds call_target_tracked_staff with every currently-active counselor
// + pre-sales staffer (same position-pattern match used elsewhere in this
// codebase), per the explicit request to auto-populate rather than start
// empty like the Monthly Targets grid does.
//
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addCallTargets.js
//   PROD: node src/migrations/addCallTargets.js --allow-remote
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

  await pool.query(`ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS call_target integer,
      ADD COLUMN IF NOT EXISTS call_target_set_by text,
      ADD COLUMN IF NOT EXISTS call_target_set_at timestamp`);

  await pool.query(`CREATE TABLE IF NOT EXISTS call_target_tracked_staff (
      staff_id integer NOT NULL PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
      sort_order integer NOT NULL DEFAULT 0,
      added_by text,
      added_at timestamp DEFAULT now()
    )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS call_targets (
      id SERIAL PRIMARY KEY,
      staff_id integer NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      month date NOT NULL,
      target integer NOT NULL CHECK (target >= 0),
      updated_by text,
      updated_at timestamp DEFAULT now(),
      UNIQUE (staff_id, month)
    )`);

  const seeded = await pool.query(`
    INSERT INTO call_target_tracked_staff (staff_id, sort_order)
    SELECT id, ROW_NUMBER() OVER (ORDER BY full_name)
      FROM staff
     WHERE is_active = true AND COALESCE(staff_type, 'permanent') <> 'event'
       AND (position ILIKE '%counsel%' OR position ILIKE '%pre%sale%')
    ON CONFLICT (staff_id) DO NOTHING
    RETURNING staff_id
  `);
  console.log(`Auto-seeded ${seeded.rowCount} active counselor/pre-sales staff into call_target_tracked_staff.`);

  const check = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='staff' AND column_name IN ('call_target','call_target_set_by','call_target_set_at')) AS staff_cols,
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='call_target_tracked_staff') AS tracked_table,
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='call_targets') AS targets_table,
      (SELECT COUNT(*) FROM call_target_tracked_staff) AS tracked_count
  `);
  console.log('Expect staff_cols=3, tracked_table=1, targets_table=1:', check.rows[0]);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

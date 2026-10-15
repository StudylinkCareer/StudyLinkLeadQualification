// Hourly call targets (2026-10, owner decision): every call target becomes
// hours worked x an hourly rate, and off-day entries record hours off.
//   - call_hour_rates: Counsellor New/Ongoing calls per worked hour, per month
//     (copy-forward like the other target grids). Seeded 10/8 and 5/8.
//   - staff_off_days.hours_off: NULL = full day off, else hours off that day.
//   - staff_off_days.hours_unknown: entries logged as "half day" in the note
//     before hours existed. The owner doesn't trust "half day" to mean
//     exactly 4h, so they deduct nothing until re-entered with real hours.
//     Flagged only when the column is first added, so a re-run never
//     re-flags an entry that has since been fixed.
//
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addHourlyCallTargets.js
//   PROD: node src/migrations/addHourlyCallTargets.js --allow-remote
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS call_hour_rates (
        month            DATE PRIMARY KEY,
        new_per_hour     NUMERIC(6,3) NOT NULL,
        ongoing_per_hour NUMERIC(6,3) NOT NULL,
        updated_by       TEXT,
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await client.query(`
      INSERT INTO call_hour_rates (month, new_per_hour, ongoing_per_hour, updated_by)
      VALUES ('2026-01-01', 1.25, 0.625, 'migration')
      ON CONFLICT (month) DO NOTHING`);

    const had = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='staff_off_days' AND column_name='hours_unknown'`);
    await client.query(`ALTER TABLE staff_off_days ADD COLUMN IF NOT EXISTS hours_off NUMERIC(4,1)`);
    await client.query(`ALTER TABLE staff_off_days ADD COLUMN IF NOT EXISTS hours_unknown BOOLEAN NOT NULL DEFAULT false`);
    let flagged = 0;
    if (had.rowCount === 0) {
      const f = await client.query(
        `UPDATE staff_off_days SET hours_unknown = true WHERE hours_off IS NULL AND note ILIKE '%half%'`);
      flagged = f.rowCount;
    }
    await client.query('COMMIT');

    const counts = (await pool.query(
      `SELECT COUNT(*)::int total,
              COUNT(*) FILTER (WHERE hours_unknown)::int unknown,
              COUNT(*) FILTER (WHERE hours_off IS NOT NULL)::int partial
         FROM staff_off_days`)).rows[0];
    console.log(`flagged as hours-unknown this run: ${flagged}`);
    console.log(`staff_off_days: ${counts.total} total, ${counts.unknown} need hours, ${counts.partial} partial`);
    console.log('call_hour_rates:', JSON.stringify((await pool.query(`SELECT to_char(month,'YYYY-MM') m, new_per_hour, ongoing_per_hour FROM call_hour_rates ORDER BY month`)).rows));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ROLLED BACK:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();

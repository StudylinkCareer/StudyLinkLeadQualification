// Wizard completion marker (2026-09): when the customer finished the whole
// "Giải Mã Xuất Ngoại" journey. Nullable, additive; read/written by hand in
// studentController (NOT in Student COLUMNS) so code can deploy before this runs.
// Usage: node src/migrations/addJourneyCompletedAt.js [--allow-remote]
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
  await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS journey_completed_at timestamptz`);
  const check = await pool.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'students' AND column_name = 'journey_completed_at'`
  );
  console.log('column present:', check.rows);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

// Source of Lead reclassification: per-student decisions. Adds a nullable
// student_id to source_reclassification_log (NULL = a whole-value Apply).
// Purely additive; safe to re-run.
//
// Usage: node Migrations/restructureSourceOfLead_06_reclassLogStudentId.js [--allow-remote]
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
  await pool.query(`ALTER TABLE source_reclassification_log ADD COLUMN IF NOT EXISTS student_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_source_reclass_log_student ON source_reclassification_log (student_id)`);
  const check = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='source_reclassification_log' AND column_name='student_id'`);
  console.log('student_id column present:', check.rowCount === 1);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

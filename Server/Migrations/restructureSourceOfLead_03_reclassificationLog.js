// Source of Lead restructure — Phase 3 schema: an audit log for the manual
// legacy-value reclassification tool (Server/src/routes/sourceReclassification.js).
// Purely additive; safe to re-run (CREATE TABLE IF NOT EXISTS).
//
// Usage: node Migrations/restructureSourceOfLead_03_reclassificationLog.js [--allow-remote]
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
    CREATE TABLE IF NOT EXISTS source_reclassification_log (
      id                  SERIAL PRIMARY KEY,
      source_column       VARCHAR(20)  NOT NULL,   -- 'source_detail' | 'referral_source'
      legacy_value        TEXT         NOT NULL,
      target_lead_source  VARCHAR(50)  NOT NULL,   -- one of the 5 lookup_values source_of_lead codes
      target_source       VARCHAR(100),            -- sub-value: online channel / b2b type / personal-referral category
      target_source_detail TEXT,                   -- sub-field: b2b partner name / personal-referral referrer name
      leads_affected      INTEGER      NOT NULL DEFAULT 0,
      applied_by          VARCHAR(200),
      applied_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_source_reclass_log_value ON source_reclassification_log (source_column, legacy_value)`);
  const check = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'source_reclassification_log' ORDER BY ordinal_position`
  );
  console.table(check.rows);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

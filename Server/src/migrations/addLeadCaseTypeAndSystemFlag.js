// Two new lead-level fields for the Sales Monthly Report:
//   - leads.case_type: manual dropdown (Du học / Sum. camp / Du lịch / Visa) —
//     no field currently distinguishes what KIND of case a contract is.
//   - leads.is_out_of_system: manual checkbox, set once on a Contracted lead —
//     whether this contract was handled/logged normally through the app
//     ("in system") or happened outside the normal flow ("out system", e.g. a
//     paper contract or sub-agent deal entered after the fact). NULL = not yet
//     classified (distinct from explicitly marking it in-system).
// Both are permanent lead-level fields (not report-only), so other reports can
// reuse them later. Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addLeadCaseTypeAndSystemFlag.js
//   PROD: node src/migrations/addLeadCaseTypeAndSystemFlag.js --allow-remote
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

  await pool.query(`ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS case_type text,
      ADD COLUMN IF NOT EXISTS is_out_of_system boolean`);

  const check = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'leads' AND column_name IN ('case_type', 'is_out_of_system')`
  );
  console.log('columns present:', check.rows.map((r) => r.column_name));
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

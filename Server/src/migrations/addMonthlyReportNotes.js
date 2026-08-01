// Monthly Report — minimal free-text notes section (Top/Underperformer
// commentary, Recommendations & Actions). Plain upsert, one row per month —
// no append/freeze semantics like weekly_recommendations, which wasn't asked
// for here and would be over-engineering for this optional field.
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addMonthlyReportNotes.js
//   PROD: node src/migrations/addMonthlyReportNotes.js --allow-remote
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
    CREATE TABLE IF NOT EXISTS monthly_report_notes (
      month       date PRIMARY KEY,
      content     text NOT NULL DEFAULT '',
      updated_by  text,
      updated_at  timestamp DEFAULT now()
    )
  `);

  const check = await pool.query(`SELECT to_regclass('public.monthly_report_notes') AS notes_table`);
  console.log(check.rows[0]);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

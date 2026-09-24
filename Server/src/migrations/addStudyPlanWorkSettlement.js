// Study plans gain two values (2026-09, Ms. Hà): "Work" (Việc làm) and
// "Settlement" (Định cư). seedLookups.js was updated too, but re-seeding prod
// would rewrite every lookup category — this adds just these two rows, idempotently.
// Usage: node src/migrations/addStudyPlanWorkSettlement.js [--allow-remote]
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

const NEW_ROWS = [
  { code: 'Work',       labelEn: 'Work',       labelVi: 'Việc làm' },
  { code: 'Settlement', labelEn: 'Settlement', labelVi: 'Định cư' },
];

(async () => {
  console.log('Target DB host: ' + host);
  const max = await pool.query(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM lookup_values WHERE category = 'study_plan'`);
  let order = Number(max.rows[0].m) + 1;
  for (const r of NEW_ROWS) {
    const res = await pool.query(
      `INSERT INTO lookup_values (category, subcategory, code, label_en, label_vi, sort_order, meta)
       VALUES ('study_plan', NULL, $1, $2, $3, $4, '{}'::jsonb)
       ON CONFLICT (category, COALESCE(subcategory, ''), code) DO NOTHING
       RETURNING id`,
      [r.code, r.labelEn, r.labelVi, order]
    );
    console.log(`${r.code}: ${res.rowCount ? 'inserted' : 'already present'}`);
    if (res.rowCount) order++;
  }
  const check = await pool.query(
    `SELECT code, label_en, label_vi, sort_order, is_active FROM lookup_values WHERE category = 'study_plan' ORDER BY sort_order`
  );
  console.table(check.rows);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

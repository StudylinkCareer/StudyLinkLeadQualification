// Adds the OPTIONAL console-access window to staff:
//   access_valid_from / access_valid_until (timestamptz, nullable).
// Blank = unrestricted (only is_active gates login). Enforced in
// staffController.login + checkSession. Distinct from event_reps' desk window.
//
// Idempotent (IF NOT EXISTS). Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addStaffAccessWindow.js
//   PROD: node src/migrations/addStaffAccessWindow.js --allow-remote
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

const pool = new Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

(async () => {
  console.log('Target DB host: ' + host);
  await pool.query(`
    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS access_valid_from  timestamptz,
      ADD COLUMN IF NOT EXISTS access_valid_until timestamptz
  `);
  const c = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name='staff' AND column_name IN ('access_valid_from','access_valid_until')
      ORDER BY column_name`
  );
  console.log('columns present: ' + (c.rows.map(r => r.column_name).join(', ') || '(none!)'));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

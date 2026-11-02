// Staff working dates (2026-11, owner): the first and last day someone worked.
// Reports use them to decide who appears in a period and how much of a call
// target applies. Separate from access_valid_from/until, which only control
// sign-in. Blank from = since the beginning; blank to = still working.
//
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addStaffEmploymentDates.js
//   PROD: node src/migrations/addStaffEmploymentDates.js --allow-remote
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
  console.log(`addStaffEmploymentDates -> ${host}`);
  await pool.query(`ALTER TABLE staff ADD COLUMN IF NOT EXISTS employed_from DATE, ADD COLUMN IF NOT EXISTS employed_to DATE`);
  console.log('Done.');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

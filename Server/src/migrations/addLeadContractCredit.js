// Contract credit (2026-11, owner): who a signed contract counts for in reports
// when that differs from the lead's current counselor/presales. Blank = the
// current owner, so existing leads report exactly as before.
//
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addLeadContractCredit.js
//   PROD: node src/migrations/addLeadContractCredit.js --allow-remote
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
  console.log(`addLeadContractCredit -> ${host}`);
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS contract_credit_to TEXT`);
  console.log('Done.');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

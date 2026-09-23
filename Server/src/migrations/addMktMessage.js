// "MKT message" exemption (2026-09, Hong Ha's request): a checkbox on the
// Zalo/WhatsApp contact-log flow so staff can flag a broadcast/marketing
// text as such. Before this, an unanswered marketing text had no honest
// option but "Không bắt máy" (didn't pick up), which classifyKbm() then
// counted as KBM and dropped from the sender's Calls KPI entirely — even
// though sending a marketing message is real work, and there's no genuine
// "did they answer" for a text nobody's expected to reply to live. Ticking
// this box exempts the note from ever being classified as KBM, regardless
// of the call_answered value (see callClassification.js's classifyKbm).
// NULL/false for every other contact method and every historical row
// logged before this feature shipped — same "only meaningful where it was
// actually asked" pattern as call_answered (see addCallAnswered.js).
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addMktMessage.js
//   PROD: node src/migrations/addMktMessage.js --allow-remote
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

  await pool.query(`ALTER TABLE student_notes ADD COLUMN IF NOT EXISTS mkt_message boolean NOT NULL DEFAULT false`);

  const check = await pool.query(
    `SELECT column_name, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'student_notes' AND column_name = 'mkt_message'`
  );
  console.log('column present:', check.rows);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

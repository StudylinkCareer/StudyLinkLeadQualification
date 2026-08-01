// Monthly Report — "Did they answer?" toggle on the contact-log flow, so
// Số cuộc KBM (KBM = "Không Bắt Máy" = didn't pick up) becomes a real
// auto-tracked count. NULL for non-call contact methods (email/SMS/WhatsApp/
// Messenger) and for every historical row logged before this feature shipped
// — only set true/false when contact_platform is 'Phone call' or 'Zalo'.
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addCallAnswered.js
//   PROD: node src/migrations/addCallAnswered.js --allow-remote
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

  await pool.query(`ALTER TABLE student_notes ADD COLUMN IF NOT EXISTS call_answered boolean`);

  const check = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'student_notes' AND column_name = 'call_answered'`
  );
  console.log('column present:', check.rows.map((r) => r.column_name));
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

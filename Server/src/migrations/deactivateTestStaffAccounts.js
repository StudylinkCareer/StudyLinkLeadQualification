// Deactivates the 'TestManager' / 'TestCounselor' QA accounts (2026-09,
// requested by Hong Ha after reviewing Individual/Company Report — their
// positions ('Lead, Counsellor' / 'Staff, Counsellor') matched the
// Counsellors-roster ILIKE pattern in weeklyStaffNames(), so they were
// showing up as extra rows in Team Performance/Telesales, inflating the
// active-staff count.
//
// Deactivate, NOT delete: `is_active=false` already removes them from every
// report (weeklyStaffNames() filters is_active=true) AND blocks their login
// (staffController.js's login check), which is everything "remove them"
// needs — with zero data-loss risk. A hard DELETE was deliberately avoided
// because TestCounselor (id 40) is not an inert test account: it has 7 real
// leads assigned as counselor, 26 real student_notes, and 146 audit_log
// rows — deleting the staff row would orphan that real data (leads.counselor
// is a free-text column, not FK-enforced, so the leads would silently point
// at a staff record that no longer exists). TestManager (id 39) has zero
// associated data and would have been safe to hard-delete, but is
// deactivated the same way for consistency — nothing currently depends on
// distinguishing "deactivated" from "deleted" for a staff record with no
// data footprint.
//
// Idempotent (WHERE full_name IN (...) — re-running just re-sets the same
// two rows to false). Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/deactivateTestStaffAccounts.js
//   PROD: node src/migrations/deactivateTestStaffAccounts.js --allow-remote
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

  const res = await pool.query(
    `UPDATE staff SET is_active = false
      WHERE full_name IN ('TestManager', 'TestCounselor')
      RETURNING id, full_name, position, is_active`
  );
  console.log('Deactivated:', JSON.stringify(res.rows, null, 2));

  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

// Corrects a single lead's actual_close_date — for cases where a contract
// was entered into the system late, so the trigger-stamped date is wrong
// (it stamps "today" at the moment lead_status flips to Contracted, not the
// real signing date).
//
// Safe because leads_stamp_close_dates() only re-stamps actual_close_date
// when lead_status itself changes (TG_OP='INSERT' OR NEW.lead_status IS
// DISTINCT FROM OLD.lead_status) — a plain UPDATE of actual_close_date alone
// does not touch lead_status, so the trigger's stamping branch never fires
// and the correction sticks.
//
// Step 1 (default): look up the lead — by full name OR by numeric --lead-id
//   (grab it from the browser URL on a numeric /leads/:id page, easier than
//   typing a Vietnamese name on a PowerShell command line) — print what's on
//   file, nothing is changed.
// Step 2: re-run with --confirm and the correct date to apply the fix.
//
// Usage:
//   node scripts/fixActualCloseDate.js "<full name>"
//   node scripts/fixActualCloseDate.js "<full name>" --confirm 2026-06-26
//   node scripts/fixActualCloseDate.js --lead-id 1234
//   node scripts/fixActualCloseDate.js --lead-id 1234 --confirm 2026-06-26
require('dotenv').config();
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set in the environment.'); process.exit(1); }
console.log('Connecting to host:', url.replace(/.*@/, '').split('/')[0]);

const leadIdIdx = process.argv.indexOf('--lead-id');
const leadIdArg = leadIdIdx !== -1 ? process.argv[leadIdIdx + 1] : null;
const fullName = (!leadIdArg && !process.argv[2]?.startsWith('--')) ? process.argv[2] : null;
const confirmIdx = process.argv.indexOf('--confirm');
const newDate = confirmIdx !== -1 ? process.argv[confirmIdx + 1] : null;
if (!fullName && !leadIdArg) {
  console.error('Usage: node scripts/fixActualCloseDate.js "<full name>" [--confirm YYYY-MM-DD]');
  console.error('   or: node scripts/fixActualCloseDate.js --lead-id <id> [--confirm YYYY-MM-DD]');
  process.exit(1);
}
if (leadIdArg && !/^\d+$/.test(leadIdArg)) {
  console.error('--lead-id must be numeric.');
  process.exit(1);
}
if (newDate && !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
  console.error('Date must be YYYY-MM-DD, e.g. 2026-06-26');
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  const { rows } = await pool.query(
    `SELECT l.lead_id, l.person_id, s.full_name, l.lead_status, l.counselor,
            l.close_date, l.actual_close_date, l.created_at, l.updated_at
       FROM leads l JOIN students s ON s.student_id = l.person_id
      WHERE ${leadIdArg ? 'l.lead_id = $1' : 's.full_name ILIKE $1'}
      ORDER BY l.lead_id DESC`,
    [leadIdArg ? Number(leadIdArg) : `%${fullName}%`]
  );

  if (!rows.length) { console.log(leadIdArg ? 'No lead with that lead_id.' : 'No matching student found.'); await pool.end(); return; }

  console.log(`${rows.length} matching lead(s):\n`);
  for (const r of rows) {
    console.log(
      `lead_id=${r.lead_id}  student=${r.full_name}  status=${r.lead_status}  counselor=${r.counselor}\n` +
      `  close_date=${r.close_date}  actual_close_date=${r.actual_close_date}\n`
    );
  }

  if (!newDate) {
    console.log('No --confirm date given — nothing changed. Re-run with --confirm YYYY-MM-DD and the correct lead_id filter if more than one matched.');
    await pool.end();
    return;
  }
  if (rows.length > 1) {
    console.log('More than one lead matched this name — refusing to auto-apply. Narrow the name or edit this script to target a specific lead_id.');
    await pool.end();
    return;
  }

  const lead = rows[0];
  const upd = await pool.query(
    `UPDATE leads SET actual_close_date = $2, updated_at = NOW()
      WHERE lead_id = $1 AND lead_status = 'Contracted'
      RETURNING lead_id, actual_close_date`,
    [lead.lead_id, newDate]
  );
  if (!upd.rowCount) {
    console.log('Update skipped — lead_status is not Contracted (refusing to set actual_close_date on a non-contracted lead).');
  } else {
    console.log(`✓ lead_id=${upd.rows[0].lead_id} actual_close_date updated -> ${upd.rows[0].actual_close_date}`);
  }
  await pool.end();
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });

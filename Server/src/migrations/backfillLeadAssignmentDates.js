// Server/src/migrations/backfillLeadAssignmentDates.js
// ---------------------------------------------------------------------------
// One-off backfill of leads.assigned_in / assigned_out from history, so existing
// leads aren't blank. Run AFTER addLeadAssignmentDates.js. Lead-grain mirror of
// the person-level backfill in backfillLifecycleDates.js.
//
//   assigned_in   <- latest audit (counselor -> non-empty) per LEAD;
//                    fallback = lead.created_at where the lead is still assigned.
//   assigned_out  <- latest audit (counselor -> empty) per LEAD, only if the
//                    lead currently has NO counsellor.
//
// Only fills NULLs, so it is idempotent and won't clobber live-stamped values.
// The UPDATEs touch only the date columns (not counselor/lead_status), so the
// BEFORE triggers leave them untouched.
// ---------------------------------------------------------------------------

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const url = process.env.DATABASE_URL || '';
const allowRemote = process.argv.includes('--allow-remote');
if (!allowRemote && !(url.includes('localhost') && url.includes('studylink_dev'))) {
  console.error('✗ Refusing to run: DATABASE_URL is not localhost/studylink_dev. Use --allow-remote for a deliberate PROD run.');
  process.exit(1);
}

async function run() {
  const client = await pool.connect();
  const log = async (label, sql) => { const r = await client.query(sql); console.log(`  ${label}: ${r.rowCount} row(s)`); };
  try {
    await client.query('BEGIN');

    // ── assigned_in (lead) ──
    await log('assigned_in (from audit)', `
      UPDATE leads l SET assigned_in = sub.d
        FROM (SELECT lead_id, max(changed_at)::date AS d FROM audit_log
               WHERE field_name='counselor' AND new_value IS NOT NULL AND btrim(new_value) <> '' AND lead_id IS NOT NULL
               GROUP BY lead_id) sub
       WHERE l.lead_id = sub.lead_id AND l.assigned_in IS NULL`);
    await log('assigned_in (fallback lead created_at)', `
      UPDATE leads SET assigned_in = created_at::date
       WHERE assigned_in IS NULL AND counselor IS NOT NULL AND btrim(counselor) <> ''`);

    // ── assigned_out (lead), only if this lead is currently unassigned ──
    await log('assigned_out (from audit)', `
      UPDATE leads l SET assigned_out = sub.d
        FROM (SELECT lead_id, max(changed_at)::date AS d FROM audit_log
               WHERE field_name='counselor' AND (new_value IS NULL OR btrim(new_value) = '') AND lead_id IS NOT NULL
               GROUP BY lead_id) sub
       WHERE l.lead_id = sub.lead_id AND l.assigned_out IS NULL
         AND (l.counselor IS NULL OR btrim(l.counselor) = '')`);

    await client.query('COMMIT');
    console.log('\n✓ backfillLeadAssignmentDates complete\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n✗ Failed, rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });

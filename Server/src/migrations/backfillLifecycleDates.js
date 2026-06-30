// Server/src/migrations/backfillLifecycleDates.js
// ---------------------------------------------------------------------------
// One-off backfill of the four lifecycle dates from history, so existing
// Contracted/Lost/assigned records aren't blank. Run AFTER addLifecycleDates.js.
//
//   actual_close_date  <- latest audit (leadStatus -> 'Contracted') per lead,
//                         for leads currently Contracted; fallback updated_at.
//   cancellation_date  <- latest audit (leadStatus -> 'Lost'/'Archived') per
//                         lead, for leads currently Lost/Archived; fb updated_at.
//   assigned_in        <- latest audit (counselor -> non-empty) per person;
//                         fallback = earliest lead created_at if still assigned.
//   assigned_out       <- latest audit (counselor -> empty) per person, only if
//                         the person currently has no counsellor on any lead.
//
// Only fills NULLs, so it is idempotent and won't clobber live-stamped values.
// The leads UPDATEs touch only the date columns (not lead_status), so the
// BEFORE trigger from addLifecycleDates.js leaves them untouched.
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

    // ── actual_close_date (leads currently Contracted) ──
    await log('actual_close_date (from audit)', `
      UPDATE leads l SET actual_close_date = sub.d
        FROM (SELECT lead_id, max(changed_at)::date AS d FROM audit_log
               WHERE field_name='leadStatus' AND new_value='Contracted' AND lead_id IS NOT NULL
               GROUP BY lead_id) sub
       WHERE l.lead_id = sub.lead_id AND l.lead_status='Contracted' AND l.actual_close_date IS NULL`);
    await log('actual_close_date (fallback updated_at)', `
      UPDATE leads SET actual_close_date = updated_at::date
       WHERE lead_status='Contracted' AND actual_close_date IS NULL`);

    // ── cancellation_date (leads currently Lost/Archived) ──
    await log('cancellation_date (from audit)', `
      UPDATE leads l SET cancellation_date = sub.d
        FROM (SELECT lead_id, max(changed_at)::date AS d FROM audit_log
               WHERE field_name='leadStatus' AND new_value IN ('Lost','Archived') AND lead_id IS NOT NULL
               GROUP BY lead_id) sub
       WHERE l.lead_id = sub.lead_id AND l.lead_status IN ('Lost','Archived') AND l.cancellation_date IS NULL`);
    await log('cancellation_date (fallback updated_at)', `
      UPDATE leads SET cancellation_date = updated_at::date
       WHERE lead_status IN ('Lost','Archived') AND cancellation_date IS NULL`);

    // ── assigned_in (person) ──
    await log('assigned_in (from audit)', `
      UPDATE students s SET assigned_in = sub.d
        FROM (SELECT student_id, max(changed_at)::date AS d FROM audit_log
               WHERE field_name='counselor' AND new_value IS NOT NULL AND btrim(new_value) <> '' AND student_id IS NOT NULL
               GROUP BY student_id) sub
       WHERE s.student_id = sub.student_id AND s.assigned_in IS NULL`);
    await log('assigned_in (fallback earliest lead)', `
      UPDATE students s SET assigned_in = sub.d
        FROM (SELECT person_id, min(created_at)::date AS d FROM leads
               WHERE counselor IS NOT NULL AND btrim(counselor) <> '' GROUP BY person_id) sub
       WHERE s.student_id = sub.person_id AND s.assigned_in IS NULL`);

    // ── assigned_out (person), only if currently unassigned everywhere ──
    await log('assigned_out (from audit)', `
      UPDATE students s SET assigned_out = sub.d
        FROM (SELECT student_id, max(changed_at)::date AS d FROM audit_log
               WHERE field_name='counselor' AND (new_value IS NULL OR btrim(new_value) = '') AND student_id IS NOT NULL
               GROUP BY student_id) sub
       WHERE s.student_id = sub.student_id AND s.assigned_out IS NULL
         AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.person_id = s.student_id
                          AND l.counselor IS NOT NULL AND btrim(l.counselor) <> '')`);

    await client.query('COMMIT');
    console.log('\n✓ backfillLifecycleDates complete\n');
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

// server/src/migrations/backfillAuditLeadId.js
//
// A3 prerequisite — lead-tag the engagement audit trail.
//
// Some `audit_log` rows for LEAD-level fields (e.g. leadStatus, counselor) have
// `lead_id = NULL` — they were written by the old student-update path AFTER the
// person/application split but BEFORE A1 added lead-keyed auditing. The lead-based
// reports join the audit on `lead_id`, so those rows would be silently dropped.
//
// This backfills `lead_id` = the student's lead for those rows, but ONLY for
// students who have exactly ONE lead (the 1:1 cutover case) — multi-lead students
// are ambiguous and left for manual handling (none expected at cutover).
//
// FORWARD-ONLY data fix (a backfill can't be cleanly reversed — we can't tell
// which rows we set vs which the split already set). Guarded + transactional.
//
// USAGE (from Server/, DATABASE_URL -> studylink_dev):
//   node src/migrations/backfillAuditLeadId.js

require('dotenv').config();
const { Pool } = require('pg');

const ARGS         = process.argv.slice(2);
const ALLOW_REMOTE = ARGS.includes('--allow-remote');

// LEAD-level audit fields (camelCase, as audit_log stores field_name). Student-level
// fields (identity / Self-Assessment / Source) stay person-keyed (lead_id NULL).
const LEAD_FIELDS = [
  'leadStatus', 'counselor', 'seniorCounselor', 'presales', 'marketingStaff',
  'closeDate', 'confidence', 'distributionStatus',
];

function hostOf(url) { const m = /@([^:@/]+)(?::\d+)?\//.exec(url || ''); return m ? m[1] : '(unparseable)'; }

async function main() {
  const url = process.env.DATABASE_URL || '';
  const host = hostOf(url);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
  console.log(`Target DB host: ${host}`);
  if (!isLocal && !ALLOW_REMOTE) {
    console.error(`\nABORT: refuses non-local host "${host}". Point DATABASE_URL at studylink_dev.`);
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = (await client.query(
      `SELECT count(*)::int n FROM audit_log WHERE lead_id IS NULL AND field_name = ANY($1)`, [LEAD_FIELDS]
    )).rows[0].n;

    const upd = await client.query(
      `UPDATE audit_log a
          SET lead_id = m.lead_id
         FROM (SELECT person_id, MIN(lead_id) AS lead_id
                 FROM leads GROUP BY person_id HAVING count(*) = 1) m
        WHERE a.student_id = m.person_id
          AND a.lead_id IS NULL
          AND a.field_name = ANY($1)`,
      [LEAD_FIELDS]
    );

    const after = (await client.query(
      `SELECT count(*)::int n FROM audit_log WHERE lead_id IS NULL AND field_name = ANY($1)`, [LEAD_FIELDS]
    )).rows[0].n;

    console.log('\n── Verification ───────────────────────────────');
    console.log(`engagement audit rows with NULL lead_id — before: ${before}`);
    console.log(`backfilled (single-lead students)             : ${upd.rowCount}`);
    console.log(`remaining NULL (multi-lead / no lead)         : ${after}`);

    await client.query('COMMIT');
    console.log(`\nCOMMITTED — lead-tagged ${upd.rowCount} engagement audit rows.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nROLLED BACK — no changes made:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch(e => { console.error(e); process.exit(1); });

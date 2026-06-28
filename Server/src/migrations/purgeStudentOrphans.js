// server/src/migrations/purgeStudentOrphans.js
//
// Maintenance sweep — delete rows orphaned by PAST student deletions (the student
// no longer exists), across tables that aren't FK-protected and so can accumulate
// junk. Complements the app-level deleteStudents cascade (which prevents NEW orphans).
//
// Re-runnable and SAFE BY DEFAULT: dry-run (report only) unless you pass --apply.
//
// USAGE
//   node src/migrations/purgeStudentOrphans.js                       # DRY RUN — report only
//   node src/migrations/purgeStudentOrphans.js --apply               # delete (localhost dev)
//   node src/migrations/purgeStudentOrphans.js --apply --allow-remote  # PROD (maintenance window)
//
// duplicate_reviews is intentionally EXCLUDED: its incoming_uid points at a parked,
// deliberately-not-yet-created person, so "not in students" is normal there, not orphaned.

require('dotenv').config();
const { Pool } = require('pg');

const ARGS         = process.argv.slice(2);
const APPLY        = ARGS.includes('--apply');
const ALLOW_REMOTE = ARGS.includes('--allow-remote');

// Child-first so deletes are safe whatever each FK's delete rule is. Each row is an
// orphan when its student key has no matching students.student_id.
const TARGETS = [
  { table: 'event_desk_visits', key: 'student_unique_id' },
  { table: 'event_attendees',   key: 'student_unique_id' },
  { table: 'lead_events',       key: 'student_id' },
  { table: 'documents',         key: 'student_id' },
  { table: 'audit_log',         key: 'student_id' },
  { table: 'student_notes',     key: 'student_id' },
  { table: 'leads',             key: 'person_id' },
];

function hostOf(url) { const m = /@([^:@/]+)(?::\d+)?\//.exec(url || ''); return m ? m[1] : '(unparseable)'; }
const orphanWhere = (t) =>
  `${t.key} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM students s WHERE s.student_id = x.${t.key})`;

async function main() {
  const url = process.env.DATABASE_URL || '';
  const host = hostOf(url);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
  console.log(`Target DB host: ${host} | mode: ${APPLY ? 'APPLY (delete)' : 'DRY RUN (report only)'}\n`);
  if (!isLocal && !ALLOW_REMOTE) {
    console.error(`ABORT: non-local host "${host}". Re-run with --allow-remote to act on a remote DB (use a maintenance window).`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    // 1. Always report first.
    console.log('Orphaned rows (student no longer exists):');
    const counts = {};
    let total = 0;
    for (const t of TARGETS) {
      const n = (await client.query(
        `SELECT count(*)::int n FROM ${t.table} x WHERE ${orphanWhere(t)}`)).rows[0].n;
      counts[t.table] = n; total += n;
      console.log(`  ${t.table.padEnd(18)} ${n}`);
    }
    console.log(`  ${'TOTAL'.padEnd(18)} ${total}`);

    if (!APPLY) {
      console.log('\nDRY RUN — nothing deleted. Re-run with --apply to purge.');
      return;
    }
    if (total === 0) { console.log('\nNothing to purge.'); return; }

    // 2. Delete, transactionally, child-first.
    await client.query('BEGIN');
    const purged = {};
    for (const t of TARGETS) {
      purged[t.table] = (await client.query(
        `DELETE FROM ${t.table} x WHERE ${orphanWhere(t)}`)).rowCount;
    }
    await client.query('COMMIT');
    console.log('\nPurged:');
    for (const t of TARGETS) console.log(`  ${t.table.padEnd(18)} ${purged[t.table]}`);
    console.log('COMMITTED.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('\nROLLED BACK — no changes made:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch(e => { console.error(e); process.exit(1); });

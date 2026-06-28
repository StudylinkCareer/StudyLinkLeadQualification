// server/src/migrations/purgeJunkRows.js
//
// DEV cleanup — remove explicit junk/test persons surfaced by the person/
// application split. Scope is deliberately narrow and explicit:
//     * the CSV-fragment row  ',300-500M VND,,4'
//     * all TEST-UPLOAD-% rows
// (TestCounselor rows are intentionally NOT swept — explicit IDs only.)
//
// Deleting a person cascades (ON DELETE CASCADE) to its applications, and
// from there to notes/audit/documents that carry application_id. Person-keyed
// children (audit_log.student_id, event_attendees, lead_events) are cleared
// explicitly first so nothing is left dangling.
//
// SAFETY
//   * DRY RUN by default — prints what it WOULD delete. --commit to apply.
//   * DEV GUARD — aborts unless DATABASE_URL host is localhost (--allow-remote
//     to override, NOT advised).
//   * Transaction-wrapped; rolls back on any error.
//
// This same purge belongs on the PRODUCTION cutover checklist — prod is a
// faithful copy, so it carries the identical junk.
//
// USAGE (Server/ dir, DATABASE_URL -> studylink_dev):
//   node src/migrations/purgeJunkRows.js            # dry run
//   node src/migrations/purgeJunkRows.js --commit   # apply

require('dotenv').config();
const { Pool } = require('pg');

const ARGS         = process.argv.slice(2);
const COMMIT       = ARGS.includes('--commit');
const ALLOW_REMOTE = ARGS.includes('--allow-remote');

const JUNK_WHERE = `(unique_id = ',300-500M VND,,4' OR unique_id LIKE 'TEST-UPLOAD-%')`;

function hostOf(url) {
  const m = /@([^:@/]+)(?::\d+)?\//.exec(url || '');
  return m ? m[1] : '(unparseable)';
}

async function main() {
  const url  = process.env.DATABASE_URL || '';
  const host = hostOf(url);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);

  console.log(`Target DB host: ${host}`);
  console.log(`Mode: ${COMMIT ? 'COMMIT (will delete)' : 'DRY RUN (no deletes)'}`);
  if (!isLocal && !ALLOW_REMOTE) {
    console.error(`\nABORT: refuses to run against non-local host "${host}". Point at studylink_dev.`);
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const ids = (await client.query(`SELECT unique_id FROM students WHERE ${JUNK_WHERE}`)).rows.map(r => r.unique_id);
    if (ids.length === 0) {
      console.log('\nNothing to purge — no matching junk rows found.');
      await client.query('ROLLBACK');
      return;
    }

    const cnt = async (sql) => (await client.query(sql, [ids])).rows[0].n;
    const persons  = ids.length;
    const apps     = await cnt(`SELECT count(*)::int n FROM applications    WHERE person_id        = ANY($1)`);
    const audit    = await cnt(`SELECT count(*)::int n FROM audit_log       WHERE student_id        = ANY($1)`);
    const notes    = await cnt(`SELECT count(*)::int n FROM student_notes   WHERE student_id        = ANY($1)`);
    const docs     = await cnt(`SELECT count(*)::int n FROM documents       WHERE student_id        = ANY($1)`);
    const evAtt    = await cnt(`SELECT count(*)::int n FROM event_attendees WHERE student_unique_id = ANY($1)`);
    const leadEv   = await cnt(`SELECT count(*)::int n FROM lead_events     WHERE student_id        = ANY($1)`);

    console.log('\n── Footprint to remove ────────────────────────');
    console.log(`persons          : ${persons}`);
    console.log(`applications     : ${apps}`);
    console.log(`audit_log        : ${audit}`);
    console.log(`student_notes    : ${notes}`);
    console.log(`documents        : ${docs}`);
    console.log(`event_attendees  : ${evAtt}`);
    console.log(`lead_events      : ${leadEv}`);

    if (COMMIT) {
      // Clear person-keyed children that don't cascade from applications.
      await client.query(`DELETE FROM event_attendees WHERE student_unique_id = ANY($1)`, [ids]);
      await client.query(`DELETE FROM lead_events     WHERE student_id        = ANY($1)`, [ids]);
      await client.query(`DELETE FROM audit_log       WHERE student_id        = ANY($1)`, [ids]);
      await client.query(`DELETE FROM student_notes   WHERE student_id        = ANY($1)`, [ids]);
      await client.query(`DELETE FROM documents       WHERE student_id        = ANY($1)`, [ids]);
      // applications cascade from students, but delete explicitly for clarity.
      await client.query(`DELETE FROM applications     WHERE person_id         = ANY($1)`, [ids]);
      await client.query(`DELETE FROM students         WHERE unique_id         = ANY($1)`, [ids]);

      // Guard: confirm they're gone.
      const left = (await client.query(`SELECT count(*)::int n FROM students WHERE ${JUNK_WHERE}`)).rows[0].n;
      if (left !== 0) {
        throw new Error(`Expected 0 junk persons after purge, found ${left} — rolling back.`);
      }
      await client.query('COMMIT');
      console.log(`\nCOMMITTED — purged ${persons} junk persons and their related rows.`);
    } else {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — nothing deleted. Re-run with --commit to apply.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nROLLED BACK — no changes:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch(e => { console.error(e); process.exit(1); });

// server/src/migrations/addStudentStatus.js
//
// Adds a PERSON-level status to students:
//   students.student_status  text  DEFAULT 'New'
//
// Every existing student is backfilled to 'New'. The full set of student
// statuses is still TBD and will later be DERIVED from the student's lead
// status(es); for now every person is simply 'New'. This is distinct from the
// per-lead `lead_status`.
//
// SAFETY: localhost-guarded, transactional, idempotent (ADD COLUMN IF NOT
// EXISTS), reversible (--reset drops the column).
//
// USAGE (from Server/, DATABASE_URL -> studylink_dev):
//   node src/migrations/addStudentStatus.js            # add + backfill 'New'
//   node src/migrations/addStudentStatus.js --reset    # drop the column

require('dotenv').config();
const { Pool } = require('pg');

const ARGS         = process.argv.slice(2);
const RESET        = ARGS.includes('--reset');
const ALLOW_REMOTE = ARGS.includes('--allow-remote');

function hostOf(url) {
  const m = /@([^:@/]+)(?::\d+)?\//.exec(url || '');
  return m ? m[1] : '(unparseable)';
}

async function main() {
  const url  = process.env.DATABASE_URL || '';
  const host = hostOf(url);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);

  console.log(`Target DB host: ${host}`);
  console.log(`Direction: ${RESET ? 'DROP student_status (--reset)' : 'ADD student_status + backfill New'}`);
  if (!isLocal && !ALLOW_REMOTE) {
    console.error(`\nABORT: refuses to run against non-local host "${host}". Point DATABASE_URL at studylink_dev.`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (RESET) {
      await client.query(`ALTER TABLE students DROP COLUMN IF EXISTS student_status`);
      console.log('dropped: students.student_status');
    } else {
      await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS student_status text`);
      await client.query(`ALTER TABLE students ALTER COLUMN student_status SET DEFAULT 'New'`);
      const upd = await client.query(
        `UPDATE students SET student_status = 'New' WHERE student_status IS NULL OR student_status = ''`
      );
      console.log(`added:   students.student_status (text, DEFAULT 'New')`);
      console.log(`backfill: ${upd.rowCount} student(s) set to 'New'`);
    }

    // Verify
    const colPresent = (await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name='students' AND column_name='student_status'`
    )).rowCount;

    console.log('\n── Verification ───────────────────────────────');
    if (RESET) {
      console.log(`students.student_status column : ${colPresent ? 'STILL PRESENT (problem)' : 'gone'}`);
      if (colPresent) throw new Error('Column still present after --reset.');
    } else {
      const total = (await client.query(`SELECT count(*)::int n FROM students`)).rows[0].n;
      const asNew = (await client.query(`SELECT count(*)::int n FROM students WHERE student_status = 'New'`)).rows[0].n;
      console.log(`students.student_status column : ${colPresent ? 'present' : 'MISSING'}`);
      console.log(`students total / set 'New'      : ${total} / ${asNew}   ${total === asNew ? 'OK (all New)' : 'MISMATCH'}`);
      if (!colPresent || total !== asNew) throw new Error('Verification failed. Rolling back.');
    }

    await client.query('COMMIT');
    console.log(`\nCOMMITTED — ${RESET ? 'dropped' : 'added'} students.student_status.`);
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

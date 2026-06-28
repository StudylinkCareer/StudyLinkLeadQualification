// server/src/migrations/renameUniqueIdToStudentId.js
//
// PERSON/LEAD restructure — PHASE 1 (column rename).
//
// Renames the students primary-key column:
//     students.unique_id  ->  students.student_id
//
// Values are unchanged (text IDs like '20260420-905', 'WISE-DN-0330'); only the
// column NAME changes. Postgres updates every dependent FOREIGN KEY target
// automatically, so the FKs that point at students(unique_id) keep working:
//     applications.person_id -> students   (applications_person_fk)
//     documents.student_id   -> students
//     student_notes / audit_log / lead_events person refs
// For tidiness this also renames any constraint/index ON students whose NAME
// embeds 'unique_id' (the PK name students_pkey doesn't, so it's left as-is).
//
// SAFETY
//   * DEV GUARD — aborts unless DATABASE_URL host is localhost (--allow-remote
//     to override, NOT advised; do NOT use here).
//   * Transaction-wrapped; rolls back on any error or failed verification.
//   * Idempotent — detects whether the rename has already happened and no-ops.
//   * --reset reverses the rename (student_id -> unique_id).
//
// USAGE (from the Server/ directory, DATABASE_URL -> studylink_dev):
//   node src/migrations/renameUniqueIdToStudentId.js           # rename forward
//   node src/migrations/renameUniqueIdToStudentId.js --reset   # rename back

require('dotenv').config();
const { Pool } = require('pg');

const ARGS         = process.argv.slice(2);
const RESET        = ARGS.includes('--reset');
const ALLOW_REMOTE = ARGS.includes('--allow-remote');

const FROM = RESET ? 'student_id' : 'unique_id';
const TO   = RESET ? 'unique_id'  : 'student_id';

function hostOf(url) {
  const m = /@([^:@/]+)(?::\d+)?\//.exec(url || '');
  return m ? m[1] : '(unparseable)';
}

async function main() {
  const url  = process.env.DATABASE_URL || '';
  const host = hostOf(url);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);

  console.log(`Target DB host: ${host}`);
  console.log(`Direction: ${FROM} -> ${TO}${RESET ? '  (--reset)' : ''}`);
  if (!isLocal && !ALLOW_REMOTE) {
    console.error(`\nABORT: refuses to run against non-local host "${host}". Point DATABASE_URL at studylink_dev.`);
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── Pre-flight: which column is present on students? ─────────────────────
    const cols = (await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'students' AND column_name = ANY($1)`,
      [['unique_id', 'student_id']]
    )).rows.map(r => r.column_name);
    const hasFrom = cols.includes(FROM);
    const hasTo   = cols.includes(TO);

    if (hasTo && !hasFrom) {
      console.log(`\nNothing to do — students.${TO} already exists (rename already applied).`);
      await client.query('ROLLBACK');
      return;
    }
    if (!hasFrom) {
      throw new Error(`Expected column students.${FROM} to exist but it does not — aborting.`);
    }
    if (hasFrom && hasTo) {
      throw new Error(`Both students.${FROM} and students.${TO} exist — ambiguous state, aborting.`);
    }

    // ── 1. Rename the column. Postgres re-points dependent FK targets. ───────
    await client.query(`ALTER TABLE students RENAME COLUMN ${FROM} TO ${TO}`);
    console.log(`Renamed column students.${FROM} -> students.${TO}`);

    // ── 2. Tidy: rename constraints/indexes ON students embedding the token ──
    const conRows = (await client.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'students'::regclass AND conname LIKE $1`,
      [`%${FROM}%`]
    )).rows;
    for (const { conname } of conRows) {
      const newName = conname.replace(FROM, TO);
      await client.query(`ALTER TABLE students RENAME CONSTRAINT "${conname}" TO "${newName}"`);
      console.log(`Renamed constraint ${conname} -> ${newName}`);
    }

    const idxRows = (await client.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'students' AND indexname LIKE $1`,
      [`%${FROM}%`]
    )).rows;
    for (const { indexname } of idxRows) {
      const newName = indexname.replace(FROM, TO);
      await client.query(`ALTER INDEX "${indexname}" RENAME TO "${newName}"`);
      console.log(`Renamed index ${indexname} -> ${newName}`);
    }

    // ── 3. Verify before commit ──────────────────────────────────────────────
    const colNow = (await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'students' AND column_name = $1`, [TO]
    )).rowCount;
    if (!colNow) throw new Error(`Post-rename check failed: students.${TO} not found.`);

    const students = (await client.query(`SELECT count(*)::int n FROM students`)).rows[0].n;
    const orphans  = (await client.query(
      `SELECT count(*)::int n
         FROM applications a LEFT JOIN students s ON s.${TO} = a.person_id
        WHERE s.${TO} IS NULL`
    )).rows[0].n;
    const sample = (await client.query(
      `SELECT s.${TO} AS id, count(a.application_id)::int AS apps
         FROM students s LEFT JOIN applications a ON a.person_id = s.${TO}
        GROUP BY s.${TO} ORDER BY s.${TO} LIMIT 5`
    )).rows;

    console.log('\n── Verification ───────────────────────────────');
    console.log(`students rows                 : ${students}`);
    console.log(`applications with no person   : ${orphans}   ${orphans === 0 ? 'OK (FK intact)' : 'BROKEN!'}`);
    console.log(`sample students.${TO} -> #apps :`);
    for (const r of sample) console.log(`   ${r.id}  (${r.apps} application${r.apps === 1 ? '' : 's'})`);

    if (orphans !== 0) {
      throw new Error('FK verification failed — applications reference a missing person. Rolling back.');
    }

    await client.query('COMMIT');
    console.log(`\nCOMMITTED — students primary key is now "${TO}".`);
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

// server/src/migrations/dropStudentEngagementColumns.js
//
// Big Item #1 — A4: drop the duplicated ENGAGEMENT columns from `students`.
// leads is now the single source of truth for engagement; every server read/write
// has been repointed (A2 writes, A3 reads). This migration:
//
//   1. RECONCILE (safety net): for single-lead students, fill any NULL/blank
//      engagement value on the lead from the old students value. Non-destructive —
//      it never overwrites a value the lead already has (lead wins on conflict).
//   2. REPORT residual drift: single-lead students whose lead value differs from the
//      (non-blank) students value. Informational — lead is authoritative; this just
//      flags anything a human may want to eyeball before the columns are gone.
//   3. DROP the 15 columns from students.
//
// `status` (Active/Inactive record flag) is STUDENT-level and is NOT dropped.
//
// Guarded (localhost only), transactional (BEGIN/COMMIT, rolls back on error).
//   node src/migrations/dropStudentEngagementColumns.js           # run
//   node src/migrations/dropStudentEngagementColumns.js --reset    # re-add columns (schema only; data NOT restored)

require('dotenv').config();
const { Pool } = require('pg');

const ARGS         = process.argv.slice(2);
const RESET        = ARGS.includes('--reset');
const ALLOW_REMOTE = ARGS.includes('--allow-remote');

const DROP_COLS = [
  'counselor', 'senior_counselor', 'presales', 'marketing_staff', 'lead_status',
  'distribution_status', 'close_date', 'confidence', 'office', 'prev_counselor',
  'destination_country', 'timeline', 'study_plans', 'process_application', 'major',
];

function hostOf(url) { const m = /@([^:@/]+)(?::\d+)?\//.exec(url || ''); return m ? m[1] : '(unparseable)'; }
const q = (c) => `"${c}"`;

async function forward(client) {
  // Guard: these columns must already exist on leads (they are the source of truth).
  const leadCols = (await client.query(
    `SELECT column_name, data_type, character_maximum_length AS len
       FROM information_schema.columns WHERE table_name = 'leads' AND table_schema = 'public'`)).rows;
  const leadColSet = new Set(leadCols.map(r => r.column_name));
  const missing = DROP_COLS.filter(c => !leadColSet.has(c));
  if (missing.length) throw new Error(`leads is missing source columns: ${missing.join(', ')} — aborting before any drop.`);

  // Only the columns that actually still exist on students get processed.
  const studentCols = new Set((await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'students' AND table_schema = 'public'`)).rows.map(r => r.column_name));
  const cols = DROP_COLS.filter(c => studentCols.has(c));
  if (!cols.length) { console.log('Nothing to do — no engagement columns remain on students.'); return; }

  console.log(`Columns to reconcile + drop (${cols.length}): ${cols.join(', ')}\n`);

  // 1. Reconcile — single-lead students only; fill blanks on the lead from students.
  console.log('── Reconcile (fill NULL/blank lead values from students, single-lead only) ──');
  for (const c of cols) {
    const r = await client.query(
      `UPDATE leads l
          SET ${q(c)} = s.${q(c)}, updated_at = NOW()
         FROM students s,
              (SELECT person_id FROM leads GROUP BY person_id HAVING count(*) = 1) one
        WHERE s.student_id = l.person_id
          AND l.person_id  = one.person_id
          AND (l.${q(c)} IS NULL OR l.${q(c)}::text = '')
          AND s.${q(c)} IS NOT NULL AND s.${q(c)}::text <> ''`);
    if (r.rowCount) console.log(`  ${c}: filled ${r.rowCount}`);
  }

  // 2. Report residual drift — single-lead students where both differ (lead wins).
  console.log('\n── Residual drift (single-lead; lead value kept, students value discarded) ──');
  let totalDrift = 0;
  for (const c of cols) {
    const r = (await client.query(
      `SELECT count(*)::int n
         FROM leads l
         JOIN students s ON s.student_id = l.person_id
         JOIN (SELECT person_id FROM leads GROUP BY person_id HAVING count(*) = 1) one
              ON one.person_id = l.person_id
        WHERE COALESCE(l.${q(c)}::text, '') <> COALESCE(s.${q(c)}::text, '')`)).rows[0].n;
    if (r) { console.log(`  ${c}: ${r} differing`); totalDrift += r; }
  }
  console.log(totalDrift ? `  (total ${totalDrift} — review if unexpected; lead is authoritative)` : '  none — leads fully cover students.');

  // 3. Drop.
  console.log('\n── Drop columns from students ──');
  for (const c of cols) {
    await client.query(`ALTER TABLE students DROP COLUMN IF EXISTS ${q(c)}`);
    console.log(`  dropped ${c}`);
  }

  const remaining = (await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'students' AND table_schema = 'public' AND column_name = ANY($1)`, [DROP_COLS])).rows;
  if (remaining.length) throw new Error(`columns still present after drop: ${remaining.map(r => r.column_name).join(', ')}`);
  console.log('\nVerified — all 15 engagement columns removed from students.');
}

async function reset(client) {
  // Schema-only restore: re-add the columns to students using the leads column types.
  // Data is NOT restored (it was dropped). Lets the migration be re-run cleanly.
  const leadCols = (await client.query(
    `SELECT column_name, data_type, character_maximum_length AS len
       FROM information_schema.columns WHERE table_name = 'leads' AND table_schema = 'public' AND column_name = ANY($1)`,
    [DROP_COLS])).rows;
  const typeOf = {};
  for (const r of leadCols) {
    typeOf[r.column_name] = r.data_type === 'character varying'
      ? (r.len ? `varchar(${r.len})` : 'varchar')
      : r.data_type;
  }
  for (const c of DROP_COLS) {
    const t = typeOf[c] || 'text';
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS ${q(c)} ${t}`);
    console.log(`  re-added ${c} ${t}`);
  }
  console.log('\nSchema restored (columns re-added empty). Data was NOT recovered.');
}

async function main() {
  const url = process.env.DATABASE_URL || '';
  const host = hostOf(url);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
  console.log(`Target DB host: ${host} | mode: ${RESET ? 'RESET (re-add)' : 'FORWARD (drop)'}\n`);
  if (!isLocal && !ALLOW_REMOTE) {
    console.error(`ABORT: refuses non-local host "${host}". Point DATABASE_URL at studylink_dev.`);
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (RESET) await reset(client); else await forward(client);
    await client.query('COMMIT');
    console.log('\nCOMMITTED.');
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

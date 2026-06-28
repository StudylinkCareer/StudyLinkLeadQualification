// server/src/migrations/mergeDuplicateStudents.js
//
// One-off cleanup: merge 5 accidental duplicate student rows.
// For each pair we KEEP the worked/live row and DELETE the other, after
// folding all unique information into the keeper.
//
//   DRY RUN (default):  node src/migrations/mergeDuplicateStudents.js
//       Prints, per pair: rows that would be re-parented, blank fields that
//       would be filled on the keeper, and any CONFLICTS (keeper already has
//       a different value - left untouched for you to handle, e.g. move a
//       stray contact into a family slot). Writes NOTHING.
//
//   APPLY:              node src/migrations/mergeDuplicateStudents.js --commit
//       Performs the merge inside a single transaction with a final guard
//       that no duplicate emails remain; rolls back on any error.
//
// Safe sequence per pair (keep K, drop D):
//   1. Fill only BLANK columns on K from D (consolidate unique info; never
//      overwrites a value K already has -> the live row's status/counsellor
//      are preserved, and differences are reported as conflicts).
//   2. Re-parent every child row keyed by student_id (student_notes,
//      audit_log, documents, event_attendees, ... - discovered dynamically)
//      from D to K, so no notes or history are lost.
//   3. Delete the D row.
//
// Run from the Server/ directory so dotenv finds .env.

require('dotenv').config();
const { Pool } = require('pg');

const COMMIT = process.argv.includes('--commit');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// keep = the row that survives; drop = the row that is merged in and deleted.
const PAIRS = [
  { email: 'aannnguyen161@gmail.com',           keep: '20260420-905', drop: '20260420-530' },
  { email: 'devitphuong@gmail.com',             keep: '20260420-072', drop: '20260420-280' },
  { email: 'kyduyensong@gmail.com',             keep: 'WISE-DN-0330', drop: '20260421-385' },
  { email: 'quynhnhinguyen02062009@gmail.com',  keep: 'WISE-DN-0013', drop: 'WISE-DN-0015' },
  { email: 'thuvuxuan09@gmail.com',             keep: 'WISE-DN-0309', drop: '20260421-577' },
];

const EXCLUDE_COLS = new Set(['unique_id', 'created_at', 'updated_at']);
const isBlank = v => v === null || v === undefined || String(v).trim() === '';

async function run() {
  const client = await pool.connect();
  try {
    // Columns to consider for fill (everything except identity/system columns).
    const cols = (await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'students'`
    )).rows.map(r => r.column_name).filter(c => !EXCLUDE_COLS.has(c));

    // Every child table that references a student via a student_id column.
    const childTables = (await client.query(
      `SELECT DISTINCT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'student_id'
          AND table_name <> 'students'`
    )).rows.map(r => r.table_name);

    console.log(`Mode: ${COMMIT ? 'COMMIT (will write)' : 'DRY RUN (no writes)'}`);
    console.log(`Child tables keyed by student_id: ${childTables.join(', ') || '(none)'}`);

    await client.query('BEGIN');

    for (const p of PAIRS) {
      const kRes = await client.query(`SELECT * FROM students WHERE unique_id = $1`, [p.keep]);
      const dRes = await client.query(`SELECT * FROM students WHERE unique_id = $1`, [p.drop]);

      console.log(`\n=== ${p.email}  :  keep ${p.keep}  <-  drop ${p.drop} ===`);
      if (kRes.rows.length === 0 || dRes.rows.length === 0) {
        console.log(`  SKIP: keeper or drop row not found (already merged?).`);
        continue;
      }
      const K = kRes.rows[0], D = dRes.rows[0];

      // Decide fills vs conflicts.
      const fills = [], conflicts = [];
      for (const c of cols) {
        const kv = K[c], dv = D[c];
        if (isBlank(kv) && !isBlank(dv))                                              fills.push([c, dv]);
        else if (!isBlank(kv) && !isBlank(dv) && String(kv).trim() !== String(dv).trim()) conflicts.push([c, kv, dv]);
      }

      // Report re-parent volume per child table.
      const childCounts = {};
      for (const tbl of childTables) {
        childCounts[tbl] = (await client.query(
          `SELECT count(*)::int AS n FROM "${tbl}" WHERE student_id = $1`, [p.drop]
        )).rows[0].n;
      }

      console.log('  re-parent ->', p.keep + ':',
        childTables.map(t => `${t}=${childCounts[t]}`).join('  ') || '(no child rows)');
      console.log(`  fill ${fills.length} blank field(s) on keeper:` + (fills.length ? '' : ' (none)'));
      fills.forEach(([c, v]) => console.log(`      ${c} = ${JSON.stringify(v)}`));
      if (conflicts.length) {
        console.log(`  CONFLICT ${conflicts.length} field(s) — keeper kept, drop value NOT applied (review, e.g. family slot):`);
        conflicts.forEach(([c, kv, dv]) => console.log(`      ${c}: keep=${JSON.stringify(kv)}  drop=${JSON.stringify(dv)}`));
      }

      if (COMMIT) {
        if (fills.length) {
          const sets = fills.map(([c], i) => `"${c}" = $${i + 1}`).join(', ');
          const vals = fills.map(([, v]) => v);
          vals.push(p.keep);
          await client.query(
            `UPDATE students SET ${sets}, updated_at = NOW() WHERE unique_id = $${vals.length}`, vals
          );
        }
        for (const tbl of childTables) {
          await client.query(`UPDATE "${tbl}" SET student_id = $1 WHERE student_id = $2`, [p.keep, p.drop]);
        }
        await client.query(`DELETE FROM students WHERE unique_id = $1`, [p.drop]);
        console.log('  -> merged and deleted drop row.');
      }
    }

    if (COMMIT) {
      // Guard: no duplicate emails remain among the five.
      const dup = await client.query(
        `SELECT lower(trim(email)) AS e, count(*) AS c
           FROM students
          WHERE lower(trim(email)) = ANY($1)
          GROUP BY 1 HAVING count(*) > 1`,
        [PAIRS.map(p => p.email)]
      );
      if (dup.rows.length) {
        console.error('\nGUARD FAILED — duplicates still present, rolling back:', dup.rows);
        await client.query('ROLLBACK');
        process.exitCode = 1;
        return;
      }
      await client.query('COMMIT');
      console.log('\nAll 5 merges committed. Duplicates resolved.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN complete — nothing written. Re-run with --commit to apply.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nMerge failed — rolled back. No changes made:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().then(() => process.exit(process.exitCode || 0)).catch(() => process.exit(1));

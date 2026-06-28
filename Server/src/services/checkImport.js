// server/src/services/checkImport.js
//
// Quick verification script — run AFTER importLeadsNotesFromExcel.js
// to see counts and the most recently inserted records.
//
// USAGE:  node checkImport.js
//
// Optional: pass a student_id to drill into one lead's notes
//   node checkImport.js 20260420-573

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const pool = require('./db');

async function main() {
  const drillId = process.argv[2]; // optional student_id to inspect

  // ── Totals ───────────────────────────────────────────────────
  const { rows: [leadCount] } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM students`
  );
  const { rows: [noteCount] } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM student_notes`
  );

  console.log('\n=== TOTALS ===');
  console.log(`  Leads in DB:  ${leadCount.total}`);
  console.log(`  Notes in DB:  ${noteCount.total}`);

  // ── Latest 20 notes (by id — true insertion order) ───────────
  const { rows: latestNotes } = await pool.query(
    `SELECT n.id, n.student_id, s.full_name, n.note_type, n.author_name,
            n.created_at, LEFT(n.content, 60) AS content_preview
     FROM student_notes n
     JOIN students s ON s.student_id = n.student_id
     ORDER BY n.id DESC
     LIMIT 20`
  );

  console.log('\n=== 20 MOST RECENTLY INSERTED NOTES ===');
  console.log('  (newest at top — sorted by note id, the true insert order)\n');
  console.log('  ID      Lead         Name                    Type       Author              Date         Content');
  console.log('  ──────  ───────────  ──────────────────────  ─────────  ──────────────────  ───────────  ──────────');
  for (const n of latestNotes) {
    const date = n.created_at instanceof Date
      ? n.created_at.toISOString().slice(0, 10)
      : String(n.created_at).slice(0, 10);
    const name = (n.full_name || '').slice(0, 22).padEnd(22);
    const author = (n.author_name || '').slice(0, 18).padEnd(18);
    const type = (n.note_type || '').slice(0, 9).padEnd(9);
    console.log(
      `  ${String(n.id).padEnd(6)}  ${n.student_id.padEnd(11)}  ${name}  ${type}  ${author}  ${date}   ${n.content_preview || ''}`
    );
  }

  // ── Notes inserted today (UTC) ───────────────────────────────
  // We can't filter on created_at (it's back-dated from the upload),
  // but we can look at recently-inserted ids.
  // Show how many notes have id > (max-1000) — rough "recent" view.
  const { rows: [maxId] } = await pool.query(`SELECT MAX(id)::int AS max FROM student_notes`);
  if (maxId.max) {
    const cutoff = Math.max(1, maxId.max - 5000);
    const { rows: [recent] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM student_notes WHERE id > $1`,
      [cutoff]
    );
    console.log(`\n  Notes with id > ${cutoff} (most recent ~5000):  ${recent.total}`);
  }

  // ── Drill-down on one lead if provided ───────────────────────
  if (drillId) {
    console.log(`\n=== ALL NOTES FOR LEAD ${drillId} ===`);
    const { rows: leadInfo } = await pool.query(
      `SELECT student_id, full_name FROM students WHERE student_id = $1`,
      [drillId]
    );
    if (!leadInfo.length) {
      console.log(`  ⚠  Lead ${drillId} not found in DB`);
    } else {
      console.log(`  Lead: ${leadInfo[0].full_name} (${leadInfo[0].student_id})\n`);
      const { rows: notes } = await pool.query(
        `SELECT id, note_type, content, author_name, created_at
         FROM student_notes WHERE student_id = $1
         ORDER BY created_at DESC, id DESC`,
        [drillId]
      );
      if (!notes.length) {
        console.log('  (no notes)');
      } else {
        for (const n of notes) {
          const date = n.created_at instanceof Date
            ? n.created_at.toISOString().slice(0, 10)
            : String(n.created_at).slice(0, 10);
          console.log(`  [${date}] ${n.note_type.padEnd(9)} by ${n.author_name}`);
          console.log(`    "${n.content}"`);
        }
        console.log(`\n  → ${notes.length} note(s) total`);
      }
    }
  } else {
    console.log('\n💡  Tip: pass a student_id to see all notes for that lead, e.g.:');
    console.log('       node checkImport.js 20260420-573\n');
  }

  await pool.end();
}

main().catch(e => { console.error(e); pool.end().finally(() => process.exit(1)); });

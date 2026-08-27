// Backfills the `topic` column for student-level notes (lead_id IS NULL)
// whose topic was silently dropped by a bug in the Family Contacts
// Mother/Father call flow (ContactLogModal -> notesAPI.addStudentLevel ->
// noteController.addStudentLevelNote, all of which forgot to forward the
// user's actual topic selection and hardcoded topic:null server-side).
//
// The note's own content text always has the selected topic verbatim on
// its own line ("Topic: <value>", from LeadDetail.jsx's ContactLogModal
// content template) even though the structured column ended up null — so
// it's safely recoverable by extracting that line, restricted to the known
// topic set used by NoteForm's dropdown (note_topic lookup) as a safety net
// against ever matching a coincidental "Topic:" line in unrelated free text.
//
// Reported 2026-08 (Hong Ha, via Huy Anh): Weekly Report's Counselling
// Letters / Meetings scheduled panels (both "prior week only", both filter
// on sn.topic) weren't counting parent/family-contact notes. Root cause
// fixed in the same commit (noteController.js, services/api.js,
// LeadDetail.jsx) — this migration only repairs data already written
// before that fix.
//
// Idempotent (only touches rows where topic IS NULL). Guard: refuses a
// non-local DB unless --allow-remote.
//   DEV : node src/migrations/backfillStudentLevelNoteTopic.js
//   PROD: node src/migrations/backfillStudentLevelNoteTopic.js --allow-remote
require('dotenv').config();
const { Pool } = require('pg');

const url  = process.env.DATABASE_URL || '';
const host = (url.split('@')[1] || '').split('/')[0] || '(unknown)';
const isLocal     = /localhost|127\.0\.0\.1|studylink_dev/.test(url);
const allowRemote = process.argv.includes('--allow-remote');

if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!isLocal && !allowRemote) {
  console.error(`Refusing to run against non-local DB (${host}) without --allow-remote`);
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

// Must match NoteForm's topic dropdown values exactly (note_topic lookup) —
// deliberately NOT a bare ".+" capture, so this can never backfill a
// coincidental "Topic:" line from unrelated free text.
const KNOWN_TOPICS = [
  'Basic Counselling Letter',
  'Final Counselling Letter',
  'First Meeting',
  'Second Meeting',
  'Office Visit',
];

(async () => {
  console.log('Target DB host: ' + host);

  const preview = await pool.query(
    `SELECT id, (regexp_match(content, 'Topic: (' || $1 || ')'))[1] AS extracted_topic
       FROM student_notes
      WHERE topic IS NULL AND lead_id IS NULL
        AND content ~ ('Topic: (' || $1 || ')')`,
    [KNOWN_TOPICS.join('|')]
  );
  console.log(`Found ${preview.rows.length} row(s) to backfill:`);
  console.log(JSON.stringify(preview.rows, null, 2));

  if (preview.rows.length === 0) { await pool.end(); return; }

  const upd = await pool.query(
    `UPDATE student_notes
        SET topic = (regexp_match(content, 'Topic: (' || $1 || ')'))[1]
      WHERE topic IS NULL AND lead_id IS NULL
        AND content ~ ('Topic: (' || $1 || ')')
    RETURNING id, topic`,
    [KNOWN_TOPICS.join('|')]
  );
  console.log(`Backfilled ${upd.rowCount} row(s):`, JSON.stringify(upd.rows, null, 2));

  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

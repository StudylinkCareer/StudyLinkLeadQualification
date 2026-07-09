// One-off backfill: link orphaned EVENT-desk notes to their student's lead.
//
// Event-desk notes were written with lead_id = NULL (person-level). After the
// Student->Lead restructure the lead record only shows lead-scoped notes, so
// those notes are invisible. This attaches each orphaned event note (topic = an
// event name, lead_id IS NULL) to the student's lead: prefer an OPEN lead, else
// the most recent lead of any status. Scoped to event notes so it will NOT
// touch genuine student-level notes.
//
// SAFE BY DEFAULT: prints the target DB host + a dry-run preview and writes
// NOTHING unless you pass --commit.
//
//   node scripts/backfillEventNoteLeads.js            # preview only
//   node scripts/backfillEventNoteLeads.js --commit   # apply (transaction)

require('dotenv').config();
const { Pool } = require('pg');

const COMMIT = process.argv.includes('--commit');
const url    = process.env.DATABASE_URL || '';
const host   = (url.match(/@([^/]*)\//) || [])[1] || '(unknown)';

// SSL by host: local Postgres needs none; a remote host (e.g. Railway PROD,
// which requires SSL) gets it — so this works whether run locally or against
// PROD, regardless of NODE_ENV.
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || host === '(unknown)';
const pool = new Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

// Rows that WOULD change, with the lead each note will be linked to.
const PREVIEW = `
  SELECT sn.id AS note_id, sn.student_id, sn.topic, pick.lead_id AS new_lead_id, pick.lead_status
  FROM student_notes sn
  JOIN (
    SELECT DISTINCT ON (l.person_id) l.person_id, l.lead_id, l.lead_status
    FROM leads l
    ORDER BY l.person_id,
             (CASE WHEN l.lead_status IN ('Contracted','Lost','Archived','Cancelled') THEN 1 ELSE 0 END),
             l.lead_id DESC
  ) pick ON pick.person_id = sn.student_id
  WHERE sn.lead_id IS NULL
    AND sn.topic IN (SELECT name FROM events)
  ORDER BY sn.id`;

const UPDATE = `
  UPDATE student_notes sn
  SET lead_id = pick.lead_id
  FROM (
    SELECT DISTINCT ON (l.person_id) l.person_id, l.lead_id
    FROM leads l
    ORDER BY l.person_id,
             (CASE WHEN l.lead_status IN ('Contracted','Lost','Archived','Cancelled') THEN 1 ELSE 0 END),
             l.lead_id DESC
  ) pick
  WHERE sn.lead_id IS NULL
    AND sn.student_id = pick.person_id
    AND sn.topic IN (SELECT name FROM events)
  RETURNING sn.id AS note_id, sn.student_id, sn.lead_id, sn.topic`;

(async () => {
  console.log(`\nTarget DB host: ${host}`);
  console.log(`Mode: ${COMMIT ? 'COMMIT (will write)' : 'DRY RUN (no changes)'}\n`);

  const preview = await pool.query(PREVIEW);
  console.log(`${preview.rowCount} orphaned event note(s) would be linked:`);
  console.table(preview.rows);

  if (!COMMIT) {
    console.log('\nDry run only. Re-run with --commit to apply.\n');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(UPDATE);
    await client.query('COMMIT');
    console.log(`\nCommitted. ${res.rowCount} note(s) updated:`);
    console.table(res.rows);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\nRolled back — no changes made:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });

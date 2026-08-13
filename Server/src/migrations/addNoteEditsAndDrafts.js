// Note editing (audit trail) + cross-device note drafts (confirmed 2026-08).
//
// student_note_edits — one row per edit, storing the PREVIOUS content before
// each change (so the full edit history is reconstructable: original ->
// edit 1 -> edit 2 -> ... -> current). student_notes.content always holds
// the current/latest text. student_notes.updated_at lets list views show an
// "(edited)" flag without joining the edits table.
//
// note_drafts — a pending call/contact note that's been "locked" by clicking
// the platform action button (Make phone call / Open Zalo / etc.) but not
// yet filled in. Created on the device where the action was taken; resumable
// from any device via the pending-notes banner/badge, since it's a real DB
// row, not browser state. Stays 'pending' indefinitely — no auto-expiry —
// until either completed (the note gets written and this row links to it)
// or manually discarded by the staffer who created it.
//
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addNoteEditsAndDrafts.js
//   PROD: node src/migrations/addNoteEditsAndDrafts.js --allow-remote
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

(async () => {
  console.log('Target DB host: ' + host);

  await pool.query(`ALTER TABLE student_notes ADD COLUMN IF NOT EXISTS updated_at timestamptz`);

  await pool.query(`CREATE TABLE IF NOT EXISTS student_note_edits (
      id SERIAL PRIMARY KEY,
      note_id integer NOT NULL REFERENCES student_notes(id) ON DELETE CASCADE,
      previous_content text NOT NULL,
      edited_by text NOT NULL,
      edited_at timestamptz DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_student_note_edits_note_id ON student_note_edits (note_id)`);

  await pool.query(`CREATE TABLE IF NOT EXISTS note_drafts (
      id SERIAL PRIMARY KEY,
      staff_id integer NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      staff_name text NOT NULL,
      student_id text NOT NULL,
      lead_id integer REFERENCES leads(lead_id) ON DELETE CASCADE,
      method text NOT NULL,
      note_type text NOT NULL,
      contact_name text,
      contact_phone text,
      contact_email text,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz DEFAULT now(),
      completed_at timestamptz,
      discarded_at timestamptz,
      completed_note_id integer REFERENCES student_notes(id)
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_note_drafts_staff_pending
      ON note_drafts (staff_id) WHERE status = 'pending'`);

  const check = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='student_notes' AND column_name='updated_at') AS updated_at_col,
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='student_note_edits') AS edits_table,
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='note_drafts') AS drafts_table
  `);
  console.log('Expect updated_at_col=1, edits_table=1, drafts_table=1:', check.rows[0]);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

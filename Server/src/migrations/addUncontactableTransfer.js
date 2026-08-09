// Uncontactable → Pre-sales auto-transfer (confirmed 2026-08).
//
// When a Sales/Counselor-owned lead is marked "Not contactable" AND the
// counselor has logged at least 3 KBM (unanswered) calls to that lead, each
// falling in a DIFFERENT one of the 3 "khung giờ" time-slots (see
// callSlots.js), the lead is automatically handed to a Pre-sales staffer
// (round-robin, least-assigned-so-far — see uncontactableTransfer.js) and
// its status flips to 'New' so the receiving staffer notices it.
//
// Scope is deliberately just the lead's own row (counselor/presales/
// lead_status) — NOT students.order_phase, which isn't wired up for a
// Presales phase yet (see orderPhase.js's BUILD SCOPE note). Extending
// that is a bigger, separate project.
//
//   uncontactable_transfer_presales_staff — the round-robin roster (who's
//     eligible to receive a transfer). Add/remove-able, mirrors
//     call_target_tracked_staff's shape.
//   uncontactable_transfers — one row per transfer performed; doubles as
//     the round-robin's "who's had the fewest so far" tiebreaker and as
//     an audit trail (which notes qualified, who it went from/to, when).
//
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addUncontactableTransfer.js
//   PROD: node src/migrations/addUncontactableTransfer.js --allow-remote
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

  await pool.query(`CREATE TABLE IF NOT EXISTS uncontactable_transfer_presales_staff (
      staff_id integer NOT NULL PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
      sort_order integer NOT NULL DEFAULT 0,
      added_by text,
      added_at timestamp DEFAULT now()
    )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS uncontactable_transfers (
      id SERIAL PRIMARY KEY,
      lead_id integer NOT NULL REFERENCES leads(lead_id) ON DELETE CASCADE,
      student_id text NOT NULL,
      from_counselor text,
      to_presales_staff_id integer NOT NULL REFERENCES staff(id),
      to_presales_name text NOT NULL,
      qualifying_note_ids integer[] NOT NULL,
      transferred_at timestamp DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_uncontactable_transfers_to_staff
      ON uncontactable_transfers (to_presales_staff_id)`);

  const check = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='uncontactable_transfer_presales_staff') AS roster_table,
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='uncontactable_transfers') AS transfers_table
  `);
  console.log('Expect roster_table=1, transfers_table=1:', check.rows[0]);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

// Server/src/migrations/migrateEventRepsToLink.js
// ---------------------------------------------------------------------------
// Moves existing synthetic event-rep staff rows (staff_type='event') into the
// new event_reps LINK table, PRESERVING each event_login_token + event_pin so
// live sign-in links keep working. Then:
//   - Case A (source_staff_id set = an existing staff member was added as a rep):
//     link event_reps -> that real staff row, and DEACTIVATE the synthetic row
//     (kept, not deleted, so past desk_sessions / note authorship stay valid).
//   - Case B (source_staff_id NULL = a genuine new recruit typed by name):
//     UPGRADE the synthetic row into a real event-only account (proper logon id
//     + password + role 'Event staff', staff_type cleared) and link event_reps
//     -> that same row.
//
// Only ACTIVE synthetic rows are migrated (dead ones have dead links anyway).
// Idempotent: skips a (event_id, staff_id) that already has a link.
//   node src/migrations/migrateEventRepsToLink.js                 # dev
//   node src/migrations/migrateEventRepsToLink.js --allow-remote  # PROD
// PREREQ: createEventReps.js must have run. Rehearse on a fresh PROD copy first.
// ---------------------------------------------------------------------------
require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');
const { eventLogonId, EVENT_DEFAULT_PASSWORD } = require('../utils/eventRep');

const ALLOW_REMOTE = process.argv.includes('--allow-remote');
const url = process.env.DATABASE_URL || '';
const host = (url.match(/@([^:@/]+)/) || [])[1] || '(?)';
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
if (!isLocal && !ALLOW_REMOTE) {
  console.error(`ABORT: non-local host "${host}". Use --allow-remote for a deliberate PROD run.`);
  process.exit(1);
}
const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

async function uniqueLogonId(client, fullName) {
  let id = eventLogonId(fullName);
  const [local, domain] = id.split('@');
  let n = 1;
  while ((await client.query(`SELECT 1 FROM staff WHERE LOWER(email) = LOWER($1)`, [id])).rowCount) {
    n += 1; id = `${local}-${n}@${domain}`;
  }
  return id;
}

(async () => {
  const client = await pool.connect();
  let linked = 0, upgraded = 0, deactivated = 0, skipped = 0;
  try {
    if (!(await client.query(`SELECT to_regclass('public.event_reps') t`)).rows[0].t) {
      throw new Error('event_reps table missing — run createEventReps.js first.');
    }
    const rows = (await client.query(
      `SELECT id, full_name, event_id, institution_id, position, valid_from, valid_until,
              event_login_token, event_pin, source_staff_id
         FROM staff
        WHERE staff_type = 'event' AND is_active = true
        ORDER BY id`)).rows;
    console.log(`Active synthetic event-rep rows to migrate: ${rows.length}`);

    for (const r of rows) {
      await client.query('BEGIN');
      try {
        const caseB = !r.source_staff_id;
        const staffId = caseB ? r.id : r.source_staff_id;

        // Skip if this (event, staff) already has a link (idempotent re-run).
        const exists = await client.query(
          `SELECT 1 FROM event_reps WHERE event_id = $1 AND staff_id = $2 LIMIT 1`, [r.event_id, staffId]);
        if (exists.rowCount) { await client.query('COMMIT'); skipped++; continue; }

        await client.query(
          `INSERT INTO event_reps
             (event_id, staff_id, position, institution_id, valid_from, valid_until, event_login_token, event_pin, is_active, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW())`,
          [r.event_id, staffId, r.position, r.institution_id, r.valid_from, r.valid_until, r.event_login_token, r.event_pin]);
        linked++;

        if (caseB) {
          // Upgrade the synthetic row into a real event-only account; move event-only fields off it.
          const logon = await uniqueLogonId(client, r.full_name);
          const pwd = crypto.createHash('sha256').update(EVENT_DEFAULT_PASSWORD).digest('hex');
          await client.query(
            `UPDATE staff SET email = $1, password_hash = $2, role = 'Event staff', staff_type = 'permanent',
                    event_id = NULL, institution_id = NULL, event_login_token = NULL, event_pin = NULL,
                    valid_from = NULL, valid_until = NULL
              WHERE id = $3`, [logon, pwd, r.id]);
          upgraded++;
        } else {
          // Existing staff member — the synthetic dup row is now redundant.
          await client.query(`UPDATE staff SET is_active = false WHERE id = $1`, [r.id]);
          deactivated++;
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`  row ${r.id} (${r.full_name}) FAILED: ${e.message}`);
        throw e;
      }
    }
    console.log(`✓ ${linked} link(s) created | ${upgraded} recruit account(s) upgraded | ${deactivated} duplicate row(s) deactivated | ${skipped} already-linked skipped`);
  } catch (e) {
    console.error('✗ migration failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();

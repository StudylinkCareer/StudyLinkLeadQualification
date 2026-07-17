// Server/src/migrations/deleteTestInstitutions.js
// ---------------------------------------------------------------------------
// Remove the test institutions "StudyLink 1", "StudyLink 2", "Deskin
// University" from the master list, plus their event desks and (test-only)
// desk sessions. Reps pointing at them are DETACHED (institution_id -> NULL,
// i.e. "To be assigned"), not deleted. Scoped beforehand: these institutions
// have ZERO event_desk_visits, so no student data is touched.
// Idempotent — re-running reports 0s.
//   node src/migrations/deleteTestInstitutions.js                 # dev
//   node src/migrations/deleteTestInstitutions.js --allow-remote  # PROD
// ---------------------------------------------------------------------------
require('dotenv').config();
const { Pool } = require('pg');

// 'To be assigned' was a stop-gap institution created by hand before the real
// no-institution option deployed; reps pointing at it are detached to NULL,
// which IS "to be assigned" in the new model.
const NAMES = ['StudyLink 1', 'StudyLink 2', 'Deskin University', 'To be assigned'];

const ARGS = process.argv.slice(2);
const ALLOW_REMOTE = ARGS.includes('--allow-remote');
const url = process.env.DATABASE_URL || '';
const host = (url.match(/@([^:@/]+)/) || [])[1] || '(?)';
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
if (!isLocal && !ALLOW_REMOTE) {
  console.error(`ABORT: non-local host "${host}". Use --allow-remote for a deliberate PROD run.`);
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inst = await client.query(`SELECT id, name FROM institutions WHERE name = ANY($1)`, [NAMES]);
    const ids = inst.rows.map((r) => r.id);
    if (ids.length === 0) {
      await client.query('ROLLBACK');
      console.log('Nothing to delete — none of the names exist.');
      return;
    }
    console.log('Deleting:', inst.rows.map((r) => `${r.name} (id ${r.id})`).join(', '));

    // Safety net: refuse if any student desk-visit references these desks.
    const visits = await client.query(
      `SELECT COUNT(*)::int AS n FROM event_desk_visits WHERE institution_id = ANY($1)`, [ids]);
    if (visits.rows[0].n > 0) {
      await client.query('ROLLBACK');
      console.error(`✗ ABORT — ${visits.rows[0].n} student desk-visit(s) reference these institutions.`);
      process.exitCode = 1;
      return;
    }

    const reps = await client.query(
      `UPDATE event_reps SET institution_id = NULL WHERE institution_id = ANY($1)`, [ids]);
    const sess = await client.query(
      `DELETE FROM desk_sessions WHERE institution_id = ANY($1)`, [ids]);
    const desks = await client.query(
      `DELETE FROM event_institutions WHERE institution_id = ANY($1)`, [ids]);
    const master = await client.query(
      `DELETE FROM institutions WHERE id = ANY($1)`, [ids]);

    await client.query('COMMIT');
    console.log(`✓ COMMITTED on ${host}`);
    console.log(`  reps detached (→ To be assigned): ${reps.rowCount}`);
    console.log(`  desk sessions deleted:            ${sess.rowCount}`);
    console.log(`  event desks deleted:              ${desks.rowCount}`);
    console.log(`  institutions deleted:             ${master.rowCount}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('✗ rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();

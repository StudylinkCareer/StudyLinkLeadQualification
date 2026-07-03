// Server/src/migrations/addOrderPhase.js
// ---------------------------------------------------------------------------
// Sales Order PHASE / DEPARTMENT layer (foundation).
// Adds students.order_phase and backfills each Order from its current owner's
// position (students.counselor -> staff.position -> phase). Phase governs
// reporting visibility (a counsellor sees only Counselling-phase Orders).
//
// Non-destructive: ADD COLUMN + backfill only. Idempotent (safe to re-run;
// re-running refreshes the phase from the current owner).
//   node src/migrations/addOrderPhase.js                 # dev
//   node src/migrations/addOrderPhase.js --allow-remote  # PROD
// ---------------------------------------------------------------------------

require('dotenv').config();
const { Pool } = require('pg');
const { POSITION_PHASE } = require('../utils/orderPhase');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const url = process.env.DATABASE_URL || '';
if (!process.argv.includes('--allow-remote') && !(url.includes('localhost') && url.includes('studylink_dev'))) {
  console.error('✗ Refusing to run: DATABASE_URL is not localhost/studylink_dev. Use --allow-remote for a deliberate PROD run.');
  process.exit(1);
}

// Build the CASE from the single-source-of-truth map in utils/orderPhase.
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const whenClauses = Object.entries(POSITION_PHASE)
  .map(([pos, phase]) => `WHEN ${q(pos)} THEN ${q(phase)}`)
  .join('\n             ');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS order_phase text`);
    // Safety net: any insert path that doesn't set a phase gets the Pool holding
    // state instead of NULL. App code (Student.create / upload / assign) still
    // syncs the real phase from the owner; this just guarantees no NULL phases.
    await client.query(`ALTER TABLE students ALTER COLUMN order_phase SET DEFAULT 'Pool'`);

    // Backfill: phase = the phase of the owner's position; unowned / unmatched
    // owner (NULL position) falls through to the Pool holding state.
    const res = await client.query(`
      UPDATE students s
         SET order_phase = sub.phase,
             updated_at  = NOW()
        FROM (
          SELECT s2.student_id,
                 CASE st.position
                   ${whenClauses}
                   ELSE 'Pool'
                 END AS phase
            FROM students s2
            LEFT JOIN staff st ON st.full_name = s2.counselor
        ) sub
       WHERE s.student_id = sub.student_id
    `);

    await client.query('COMMIT');
    console.log(`✓ students.order_phase ensured; backfilled ${res.rowCount} order(s) from their owner's position.`);

    const chk = await client.query(
      `SELECT order_phase, count(*)::int AS n FROM students GROUP BY order_phase ORDER BY n DESC`
    );
    console.log('Phase distribution:');
    for (const r of chk.rows) console.log(`  ${r.order_phase || '(null)'}: ${r.n}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✗ Failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();

// Server/src/migrations/addOrderAssignments.js
// ---------------------------------------------------------------------------
// Phase-driven model — stage B (data foundation).
// Creates order_assignments: one row per Order × staff POSITION, so an Order can
// hold an owner for EVERY position (not just the 4 legacy columns) and remember
// them all as it moves through phases. The phase's active position(s) are the
// live owner(s); the rest are display-only reference.
//
// Backfills from the legacy students.* columns (kept in place for now; dropped
// later once all reads/writes use this table):
//   counselor -> Counselor · senior_counselor -> Senior Counselor
//   presales  -> PreSales  · marketing_staff  -> Marketing Staff
//
// Non-destructive: CREATE TABLE IF NOT EXISTS + backfill with ON CONFLICT DO
// NOTHING. Idempotent (safe to re-run; won't clobber later edits).
//   node src/migrations/addOrderAssignments.js                 # dev
//   node src/migrations/addOrderAssignments.js --allow-remote  # PROD
// ---------------------------------------------------------------------------

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const url = process.env.DATABASE_URL || '';
if (!process.argv.includes('--allow-remote') && !(url.includes('localhost') && url.includes('studylink_dev'))) {
  console.error('✗ Refusing to run: DATABASE_URL is not localhost/studylink_dev. Use --allow-remote for a deliberate PROD run.');
  process.exit(1);
}

// Legacy column -> canonical staff.position (matches Staff.jsx POSITIONS).
const COLUMN_POSITION = {
  counselor:        'Counselor',
  senior_counselor: 'Senior Counselor',
  presales:         'PreSales',
  marketing_staff:  'Marketing Staff',
};

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS order_assignments (
        student_id text        NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
        position   text        NOT NULL,
        staff_name text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (student_id, position)
      )`);

    let total = 0;
    for (const [col, position] of Object.entries(COLUMN_POSITION)) {
      const r = await client.query(
        `INSERT INTO order_assignments (student_id, position, staff_name)
         SELECT student_id, $1, ${col}
           FROM students
          WHERE ${col} IS NOT NULL AND btrim(${col}) <> ''
         ON CONFLICT (student_id, position) DO NOTHING`,
        [position]);
      console.log(`  ${col} -> ${position}: ${r.rowCount} assignment(s)`);
      total += r.rowCount;
    }

    await client.query('COMMIT');
    console.log(`✓ order_assignments ensured; backfilled ${total} assignment(s) from legacy columns.`);

    const chk = await client.query(
      `SELECT position, count(*)::int AS n FROM order_assignments GROUP BY position ORDER BY n DESC`);
    console.log('\nAssignments per position:');
    for (const r of chk.rows) console.log(`  ${r.position}: ${r.n}`);
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

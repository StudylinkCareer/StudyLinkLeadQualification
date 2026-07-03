// Server/src/migrations/reinstateOrderStaffAssignment.js
// ---------------------------------------------------------------------------
// Sales-Order-driven staff assignment (stage 1 of the model change).
// Re-adds the staff-assignment columns to `students` (the Sales Order) as the
// CANONICAL owner, and backfills each order from its current owner — the latest
// ACTIVE lead (fallback: latest lead of any status), matching the derived-owner
// rule the UI has been using. Leads keep their own staff copy (active leads
// mirror the order; locked leads retain theirs).
//
// Non-destructive: only ADDs columns + backfills. Idempotent (safe to re-run;
// re-running refreshes the backfill from the current owner).
//   node src/migrations/reinstateOrderStaffAssignment.js                 # dev
//   node src/migrations/reinstateOrderStaffAssignment.js --allow-remote  # PROD
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

// Terminal (closed/locked) statuses — an active lead is anything NOT in here.
const TERMINAL = ['Contracted', 'Lost', 'Archived', 'Cancelled'];

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE students
        ADD COLUMN IF NOT EXISTS counselor        text,
        ADD COLUMN IF NOT EXISTS senior_counselor text,
        ADD COLUMN IF NOT EXISTS presales         text,
        ADD COLUMN IF NOT EXISTS marketing_staff  text
    `);

    // Backfill each order from its current owner: latest ACTIVE lead first
    // (active = lead_status NOT terminal), else the latest lead of any status.
    const res = await client.query(
      `UPDATE students s SET
          counselor        = o.counselor,
          senior_counselor = o.senior_counselor,
          presales         = o.presales,
          marketing_staff  = o.marketing_staff
        FROM (
          SELECT DISTINCT ON (person_id)
                 person_id, counselor, senior_counselor, presales, marketing_staff
            FROM leads
           ORDER BY person_id,
                    (CASE WHEN lead_status = ANY($1) THEN 1 ELSE 0 END),   -- active leads first
                    lead_id DESC                                            -- then most recent
        ) o
       WHERE s.student_id = o.person_id`,
      [TERMINAL]
    );

    await client.query('COMMIT');
    console.log(`✓ students staff columns ensured; backfilled ${res.rowCount} order(s) from their current owner.`);

    const chk = await client.query(
      `SELECT count(*)::int AS with_counselor FROM students WHERE counselor IS NOT NULL AND counselor <> ''`
    );
    console.log(`Orders now carrying a counselor: ${chk.rows[0].with_counselor}`);
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

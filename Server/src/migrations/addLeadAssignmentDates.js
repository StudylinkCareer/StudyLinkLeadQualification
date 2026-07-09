// Server/src/migrations/addLeadAssignmentDates.js
// ---------------------------------------------------------------------------
// Captures assigned-in / assigned-out at the LEAD grain (the person already has
// students.assigned_in/out via addLifecycleDates.js). Reporting cares about the
// lead's own dates, so each lead now stamps its own:
//
//   leads.assigned_in   — date THIS lead was (re)assigned to a counsellor
//   leads.assigned_out  — date THIS lead was last left with NO counsellor
//
// A BEFORE trigger stamps NEW.assigned_in/out on the lead itself (mirrors the
// existing leads_stamp_close_dates BEFORE trigger). This runs alongside — not
// instead of — trg_leads_assignment, which still rolls the date up to the person.
//
// Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION +
// DROP/CREATE TRIGGER. Safe to re-run / cutover.
// ---------------------------------------------------------------------------

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const url = process.env.DATABASE_URL || '';
const allowRemote = process.argv.includes('--allow-remote');
if (!allowRemote && !(url.includes('localhost') && url.includes('studylink_dev'))) {
  console.error('✗ Refusing to run: DATABASE_URL is not localhost/studylink_dev. Use --allow-remote for a deliberate PROD run.');
  process.exit(1);
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE leads
        ADD COLUMN IF NOT EXISTS assigned_in  date,
        ADD COLUMN IF NOT EXISTS assigned_out date
    `);
    console.log('[1] columns ensured (leads.assigned_in / assigned_out)');

    // BEFORE trigger: stamp the LEAD's own assigned_in / assigned_out from its
    // counsellor transitions. Mirrors the person-level logic in trg_leads_assignment
    // but writes NEW.* on the lead row (never clears the opposite date).
    await client.query(`
      CREATE OR REPLACE FUNCTION leads_stamp_lead_assignment_dates() RETURNS trigger AS $$
      DECLARE vn_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.counselor IS NOT NULL AND btrim(NEW.counselor) <> '' THEN
            NEW.assigned_in := vn_today;
          END IF;
        ELSIF NEW.counselor IS DISTINCT FROM OLD.counselor THEN
          IF NEW.counselor IS NOT NULL AND btrim(NEW.counselor) <> '' THEN
            NEW.assigned_in := vn_today;    -- assigned or reassigned
          ELSE
            NEW.assigned_out := vn_today;   -- this lead lost its counsellor
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('[2] trigger function created (leads_stamp_lead_assignment_dates)');

    await client.query(`DROP TRIGGER IF EXISTS trg_leads_lead_assignment_dates ON leads`);
    await client.query(`
      CREATE TRIGGER trg_leads_lead_assignment_dates
        BEFORE INSERT OR UPDATE ON leads
        FOR EACH ROW EXECUTE FUNCTION leads_stamp_lead_assignment_dates()
    `);
    console.log('[3] BEFORE trigger attached (trg_leads_lead_assignment_dates)');

    await client.query('COMMIT');
    console.log('\n✓ addLeadAssignmentDates complete\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n✗ Failed, rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });

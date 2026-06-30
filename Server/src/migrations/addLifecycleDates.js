// Server/src/migrations/addLifecycleDates.js
// ---------------------------------------------------------------------------
// Adds four auto-stamped lifecycle date fields and the DB triggers that keep
// them current across EVERY write path (manual edit, mass-assign, distribution):
//
//   leads.actual_close_date   — stamped when lead_status becomes 'Contracted'
//                               (cleared if the lead later leaves Contracted)
//   leads.cancellation_date   — stamped when lead_status becomes 'Lost'/'Archived'
//                               (cleared if the lead is reactivated)
//   students.assigned_in      — date the person was assigned to their CURRENT
//                               counsellor (updates on each (re)assignment)
//   students.assigned_out     — date the person was last left with NO counsellor
//                               on any lead (a transfer A->B does NOT set this)
//
// Triggers use Vietnam local date. Idempotent: ADD COLUMN IF NOT EXISTS +
// CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER. Safe to re-run / cutover.
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
      ALTER TABLE students
        ADD COLUMN IF NOT EXISTS assigned_in  date,
        ADD COLUMN IF NOT EXISTS assigned_out date
    `);
    await client.query(`
      ALTER TABLE leads
        ADD COLUMN IF NOT EXISTS actual_close_date date,
        ADD COLUMN IF NOT EXISTS cancellation_date date
    `);
    console.log('[1] columns ensured (students.assigned_in/out, leads.actual_close_date/cancellation_date)');

    // ── Trigger 1: stamp the lead's own close / cancellation dates ──
    await client.query(`
      CREATE OR REPLACE FUNCTION leads_stamp_close_dates() RETURNS trigger AS $$
      DECLARE vn_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
      BEGIN
        IF TG_OP = 'INSERT' OR NEW.lead_status IS DISTINCT FROM OLD.lead_status THEN
          -- Actual close date: set on entering Contracted, cleared otherwise
          IF NEW.lead_status = 'Contracted' THEN
            IF TG_OP = 'INSERT' OR COALESCE(OLD.lead_status,'') <> 'Contracted' THEN
              NEW.actual_close_date := vn_today;
            END IF;
          ELSE
            NEW.actual_close_date := NULL;
          END IF;
          -- Cancellation date: set on entering Lost/Archived, cleared otherwise
          IF NEW.lead_status IN ('Lost','Archived') THEN
            IF TG_OP = 'INSERT' OR COALESCE(OLD.lead_status,'') NOT IN ('Lost','Archived') THEN
              NEW.cancellation_date := vn_today;
            END IF;
          ELSE
            NEW.cancellation_date := NULL;
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // ── Trigger 2: stamp the person's assigned_in / assigned_out ──
    await client.query(`
      CREATE OR REPLACE FUNCTION leads_stamp_assignment() RETURNS trigger AS $$
      DECLARE vn_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.counselor IS NOT NULL AND btrim(NEW.counselor) <> '' THEN
            UPDATE students SET assigned_in = vn_today WHERE student_id = NEW.person_id;
          END IF;
        ELSIF NEW.counselor IS DISTINCT FROM OLD.counselor THEN
          IF NEW.counselor IS NOT NULL AND btrim(NEW.counselor) <> '' THEN
            -- assigned to a (new) counsellor
            UPDATE students SET assigned_in = vn_today WHERE student_id = NEW.person_id;
          ELSE
            -- counsellor removed: only "assigned out" if the person now has no
            -- counsellor on ANY lead (a transfer never lands here)
            IF NOT EXISTS (
              SELECT 1 FROM leads
               WHERE person_id = NEW.person_id AND counselor IS NOT NULL AND btrim(counselor) <> ''
            ) THEN
              UPDATE students SET assigned_out = vn_today WHERE student_id = NEW.person_id;
            END IF;
          END IF;
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('[2] trigger functions created');

    await client.query(`DROP TRIGGER IF EXISTS trg_leads_close_dates ON leads`);
    await client.query(`
      CREATE TRIGGER trg_leads_close_dates
        BEFORE INSERT OR UPDATE ON leads
        FOR EACH ROW EXECUTE FUNCTION leads_stamp_close_dates()
    `);
    await client.query(`DROP TRIGGER IF EXISTS trg_leads_assignment ON leads`);
    await client.query(`
      CREATE TRIGGER trg_leads_assignment
        AFTER INSERT OR UPDATE ON leads
        FOR EACH ROW EXECUTE FUNCTION leads_stamp_assignment()
    `);
    console.log('[3] triggers attached to leads');

    // ── Seed the Leads-list column catalog so the 4 dates appear as columns ──
    // (read-only: list view + detail view, no edit). Mirrors unify_column_metadata.
    const NEW_COLS = [
      { key: 'assignedIn',       label: 'Assigned In',       width: 110, order: 26 },
      { key: 'assignedOut',      label: 'Assigned Out',      width: 110, order: 27 },
      { key: 'actualCloseDate',  label: 'Actual Close Date', width: 130, order: 28 },
      { key: 'cancellationDate', label: 'Cancellation Date', width: 130, order: 29 },
    ];
    const roles = ['Admin', 'Manager', 'Director', 'Counselor'];
    for (const c of NEW_COLS) {
      await client.query(
        `INSERT INTO permission_fields (field_name, category, resource, label, column_width, column_order)
         VALUES ($1, 'other', 'leads', $2, $3, $4)
         ON CONFLICT (field_name) DO UPDATE
           SET label = EXCLUDED.label, column_width = EXCLUDED.column_width, column_order = EXCLUDED.column_order`,
        [c.key, c.label, c.width, c.order]
      );
      for (const role of roles) {
        await client.query(
          `INSERT INTO role_field_permissions (role, field_name, resource, list_permission, detail_permission, updated_by)
           VALUES ($1, $2, 'leads', 'view', 'view', 'lifecycle_seed')
           ON CONFLICT (role, field_name) DO NOTHING`,
          [role, c.key]
        );
      }
    }
    console.log('[4] catalog rows + role permissions seeded for the 4 columns');

    await client.query('COMMIT');
    console.log('\n✓ addLifecycleDates complete\n');
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

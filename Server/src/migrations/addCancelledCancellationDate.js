// Server/src/migrations/addCancelledCancellationDate.js
// ---------------------------------------------------------------------------
// Fix: the leads close/cancellation-date trigger stamped cancellation_date only
// on Lost/Archived, so the new 'Cancelled' status never got a date. This
// redefines leads_stamp_close_dates() to also cover 'Cancelled', re-attaches
// the trigger (idempotent — also fixes the case where it wasn't attached), and
// backfills existing closed leads missing a cancellation_date.
//   node src/migrations/addCancelledCancellationDate.js                 # dev
//   node src/migrations/addCancelledCancellationDate.js --allow-remote  # PROD
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

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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
          -- Cancellation date: set on entering Lost/Archived/Cancelled, cleared otherwise
          IF NEW.lead_status IN ('Lost','Archived','Cancelled') THEN
            IF TG_OP = 'INSERT' OR COALESCE(OLD.lead_status,'') NOT IN ('Lost','Archived','Cancelled') THEN
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

    // Ensure the trigger is attached and uses the updated function.
    await client.query(`DROP TRIGGER IF EXISTS trg_leads_close_dates ON leads`);
    await client.query(`
      CREATE TRIGGER trg_leads_close_dates
        BEFORE INSERT OR UPDATE ON leads
        FOR EACH ROW EXECUTE FUNCTION leads_stamp_close_dates()
    `);

    // Backfill existing closed leads that are missing a cancellation_date
    // (proxy = last-updated date, else today).
    const bf = await client.query(`
      UPDATE leads
         SET cancellation_date = COALESCE(updated_at::date, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
       WHERE lead_status IN ('Lost','Archived','Cancelled')
         AND cancellation_date IS NULL
    `);

    await client.query('COMMIT');
    console.log("✓ Trigger updated: cancellation_date now stamped for Lost / Archived / Cancelled (and re-attached).");
    console.log(`  Backfilled cancellation_date on ${bf.rowCount} existing closed lead(s).`);
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

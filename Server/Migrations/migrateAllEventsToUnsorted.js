// server/src/migrations/migrateAllEventsToUnsorted.js
// Run from Server\ :  node src/migrations/migrateAllEventsToUnsorted.js
//
// "Bring them all across" — no tagging. Copies every ACTIVE lookup_values row
// under category='referral_source' into the events table, parked under a
// holding group "Unsorted" / type "Unsorted", preserving name + dates.
//
// Then sort them in the Events admin: change Group/Type, or delete. Anything
// that's really a sub-agent/partner: delete it here, add it to that list later.
//
// READ-old / WRITE-new — the referral_source list is untouched. Idempotent.

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const HOLD = 'Unsorted';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const cleanDate = (v) => (v && ISO.test(String(v).trim())) ? String(v).trim() : null;

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure the holding group + type exist (so they show in the admin dropdowns).
    const g = await client.query(
      `SELECT 1 FROM lookup_values WHERE category='event_group' AND code=$1`, [HOLD]);
    if (g.rowCount === 0) {
      await client.query(
        `INSERT INTO lookup_values (category, code, label_en, label_vi, sort_order, is_active)
         VALUES ('event_group', $1, $1, $1, 999, true)`, [HOLD]);
    }
    const t = await client.query(
      `SELECT 1 FROM lookup_values WHERE category='event_type' AND subcategory=$1 AND code=$1`, [HOLD]);
    if (t.rowCount === 0) {
      await client.query(
        `INSERT INTO lookup_values (category, subcategory, code, label_en, label_vi, sort_order, is_active)
         VALUES ('event_type', $1, $1, $1, $1, 999, true)`, [HOLD]);
    }

    // Pull every active old entry.
    const src = await client.query(
      `SELECT code,
              meta->>'startDate' AS start_date,
              meta->>'endDate'   AS end_date
         FROM lookup_values
        WHERE category='referral_source' AND is_active=true
        ORDER BY sort_order DESC, code ASC`
    );

    let inserted = 0;
    for (const row of src.rows) {
      const name = (row.code || '').trim();
      if (!name) continue;
      await client.query(
        `INSERT INTO events (event_group, event_type, name, start_date, end_date, meta, is_active)
         VALUES ($1,$1,$2,$3::date,$4::date,'{}'::jsonb,true)
         ON CONFLICT (event_group, event_type, name)
         DO UPDATE SET start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date, is_active=true`,
        [HOLD, name, cleanDate(row.start_date), cleanDate(row.end_date)]
      );
      inserted++;
    }

    await client.query('COMMIT');
    console.log(`\n✓ Brought ${inserted} entries into events under "${HOLD} / ${HOLD}".`);
    console.log('  Sort them in the Events admin (change Group/Type, or delete).');
    console.log('  Tip: when the Unsorted bucket is empty, deactivate the holding lookups:');
    console.log("    UPDATE lookup_values SET is_active=false WHERE code='Unsorted' AND category IN ('event_group','event_type');");
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed (rolled back):', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();

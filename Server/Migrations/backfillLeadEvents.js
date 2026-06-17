// server/src/migrations/backfillLeadEvents.js
// Run from Server\ :  node src/migrations/backfillLeadEvents.js
//
// R3 Phase 3 (Option A) — migrate each lead's flat campaign/event data into a
// lead_events registration row, and make event_id nullable (the registration
// model covers non-event sources too — B2B / Personal / Databases — which have
// no catalog event). Idempotent: skips students that already have a
// registration; safe to re-run.
//
//   For every student carrying a real event name (campaign_name, else
//   referral_source — excluding placeholders like "Unknown"), insert one row:
//     source_of_lead = 'Event/Campaign'
//     source         = the event name
//     event_id       = matching events.id (by name) if one exists, else NULL
//     status         = NULL  (attendance unknown — staff set it later)
//   The flat columns on students are left untouched (data preserved).

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// values that mean "no real data" — never become a registration
const PLACEHOLDERS = ['unknown', 'n/a', 'na', 'none', 'tbd', 'null', '-', '.', '?'];

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // event_id must be optional for non-event registrations
    await client.query(`ALTER TABLE lead_events ALTER COLUMN event_id DROP NOT NULL`);
    console.log('✓ lead_events.event_id is now nullable');

    const result = await client.query(`
      INSERT INTO lead_events (student_id, event_id, source_of_lead, source, status, created_at, updated_at)
      SELECT s.unique_id,
             (SELECT e.id FROM events e
               WHERE e.name = COALESCE(NULLIF(btrim(s.campaign_name), ''), NULLIF(btrim(s.referral_source), ''))
                 AND e.is_active = true
               LIMIT 1),
             'Event/Campaign',
             COALESCE(NULLIF(btrim(s.campaign_name), ''), NULLIF(btrim(s.referral_source), '')),
             NULL,
             now(), now()
        FROM students s
       WHERE COALESCE(NULLIF(btrim(s.campaign_name), ''), NULLIF(btrim(s.referral_source), '')) IS NOT NULL
         AND lower(COALESCE(NULLIF(btrim(s.campaign_name), ''), NULLIF(btrim(s.referral_source), ''))) <> ALL($1::text[])
         AND NOT EXISTS (SELECT 1 FROM lead_events le WHERE le.student_id = s.unique_id)
    `, [PLACEHOLDERS]);
    console.log(`✓ created ${result.rowCount} registration rows from flat campaign data`);

    const linked   = await client.query(`SELECT COUNT(*)::int AS n FROM lead_events WHERE event_id IS NOT NULL`);
    const unlinked = await client.query(`SELECT COUNT(*)::int AS n FROM lead_events WHERE event_id IS NULL`);
    console.log(`  • linked to a catalog event : ${linked.rows[0].n}`);
    console.log(`  • name kept, no event match : ${unlinked.rows[0].n}`);

    await client.query('COMMIT');
    console.log('\n✓ R3 Phase 3 backfill complete');
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

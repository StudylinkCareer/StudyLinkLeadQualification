// server/src/migrations/addFlatEventFields.js
// Run from Server\ :  node src/migrations/addFlatEventFields.js
//
// R2a foundation — prepares the events table for the FLAT format (single
// Event Type instead of Group → Type), without breaking the current page.
// Purely ADDITIVE + idempotent:
//
//   events: + label_en, label_vi  (optional display labels)
//           + dedicated_counsellor (optional; used by the event QR)
//           event_group column is RETAINED (deprecated, not dropped) so no
//           existing tagging is lost.
//
//   lookup_values: seeds a FLAT event_type list (subcategory = NULL) from the
//   distinct event_type values already on your events — so every type you've
//   tagged (incl. "Unsorted") becomes a dropdown option. The old per-group
//   event_type / event_group lookups are left active; the current page keeps
//   working until the new flat page deploys.

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function seedFlat(client, code, sort) {
  const hit = await client.query(
    `SELECT id FROM lookup_values
      WHERE category='event_type' AND COALESCE(subcategory,'')='' AND code=$1`,
    [code]
  );
  if (hit.rowCount > 0) {
    await client.query(`UPDATE lookup_values SET is_active=true WHERE id=$1`, [hit.rows[0].id]);
    return false;
  }
  await client.query(
    `INSERT INTO lookup_values (category, subcategory, code, label_en, label_vi, sort_order, is_active)
     VALUES ('event_type', NULL, $1, $1, $1, $2, true)`,
    [code, sort]
  );
  return true;
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS label_en             VARCHAR(200)`);
    await client.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS label_vi             VARCHAR(200)`);
    await client.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS dedicated_counsellor VARCHAR(120)`);
    console.log('✓ columns ensured on events (label_en, label_vi, dedicated_counsellor)');

    // seed flat event_type from distinct values already on events
    const distinct = await client.query(
      `SELECT DISTINCT event_type FROM events
        WHERE event_type IS NOT NULL AND btrim(event_type) <> '' ORDER BY event_type`
    );
    let added = 0, total = 0;
    for (let i = 0; i < distinct.rows.length; i++) {
      total++;
      if (await seedFlat(client, distinct.rows[i].event_type, i)) added++;
    }
    // guarantee an "Unsorted" option exists even if no events carry it yet
    if (await seedFlat(client, 'Unsorted', total)) added++;
    console.log(`✓ flat event_type seeded: ${added} new / ${total + 1} considered (incl. Unsorted)`);

    await client.query('COMMIT');
    console.log('\n✓ R2a foundation complete (additive — current page unaffected)');
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

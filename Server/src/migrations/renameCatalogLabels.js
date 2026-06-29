// Server/src/migrations/renameCatalogLabels.js
// ---------------------------------------------------------------------------
// Post-restructure label/order corrections to the Leads list column catalog
// (permission_fields). DISPLAY-ONLY — does NOT touch DB column names or keys.
//
//   #2  studentId  label "Student ID"  -> "Sales ID"
//       closeDate  label "Close Date"  -> "Projected close date"
//   #8  studentId  column_order        -> before leadId, so the leading
//                                         sequence reads Sales ID, Lead ID, Name
//
// Idempotent: matches on field_name and just sets the target values, so it is
// safe to re-run (and to run again at PROD cutover).
// ---------------------------------------------------------------------------

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Safety: refuse to run anywhere other than the local dev DB unless explicitly
// allowed for a PROD cutover (--allow-remote), matching the other migrations.
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

    const updates = [
      { field: 'studentId', set: `label = 'Sales ID', column_order = -3` },             // #2 + #8 (before leadId at -2)
      { field: 'closeDate', set: `label = 'Projected close date'` },                    // #2
    ];

    for (const u of updates) {
      const r = await client.query(
        `UPDATE permission_fields SET ${u.set} WHERE field_name = $1`, [u.field]
      );
      console.log(`  ${u.field}: ${r.rowCount} row(s) updated`);
    }

    await client.query('COMMIT');

    const check = await client.query(
      `SELECT field_name, label, column_order FROM permission_fields
        WHERE field_name IN ('studentId','leadId','fullName','closeDate')
        ORDER BY column_order`
    );
    console.log('\n✓ Catalog now:');
    check.rows.forEach(r => console.log(`    ${String(r.column_order).padStart(3)}  ${r.field_name.padEnd(12)} ${r.label}`));
    console.log('\n✓ renameCatalogLabels complete\n');
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

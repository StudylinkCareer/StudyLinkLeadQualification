// Server/src/migrations/addCancelledLeadStatus.js
// ---------------------------------------------------------------------------
// Adds the 'Cancelled' lead status to the lead_status lookup so it shows up in
// the Leads-list status FILTER. (The lead-edit dropdown is a hardcoded list in
// LeadDetail.jsx that already includes 'Cancelled'.) Mirrors how other lookup
// values are seeded (see addStudentStatusDerivation.js): lookup_values columns
// (category, code, label_en, label_vi, sort_order, is_active). Idempotent.
//   node src/migrations/addCancelledLeadStatus.js                 # dev
//   node src/migrations/addCancelledLeadStatus.js --allow-remote  # PROD
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
    const r = await client.query(
      `INSERT INTO lookup_values (category, code, label_en, label_vi, sort_order, is_active)
       SELECT 'lead_status', 'Cancelled', 'Cancelled', 'Đã hủy',
              COALESCE((SELECT MAX(sort_order) FROM lookup_values WHERE category = 'lead_status'), -1) + 1,
              true
        WHERE NOT EXISTS (
          SELECT 1 FROM lookup_values WHERE category = 'lead_status' AND code = 'Cancelled'
        )`
    );
    await client.query('COMMIT');
    console.log(r.rowCount ? "✓ 'Cancelled' added to the lead_status lookup." : "• 'Cancelled' already present — no change.");

    const chk = await client.query(
      `SELECT code, label_en, label_vi, sort_order, is_active
         FROM lookup_values WHERE category = 'lead_status' ORDER BY sort_order`
    );
    console.log('\nlead_status values now:');
    chk.rows.forEach(x => console.log(
      `  ${String(x.sort_order).padStart(2)}  ${String(x.code).padEnd(28)} ${x.label_en || ''} / ${x.label_vi || ''}${x.is_active ? '' : '  (inactive)'}`
    ));
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

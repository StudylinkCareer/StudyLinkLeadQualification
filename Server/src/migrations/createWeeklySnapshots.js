// Server/src/migrations/createWeeklySnapshots.js
// ---------------------------------------------------------------------------
// Storage for the FROZEN Weekly Report. Each Monday 08:00 (Asia/Ho_Chi_Minh) a
// snapshot of the just-closed week's full report is stored here; the /weekly
// endpoint serves the stored snapshot (static) rather than recomputing live.
//
//   week_start   : Monday (VN) of the reported week — PK
//   data         : the full frozen payload (staff, contractedTotals, byLabel)
//   generated_at : when the snapshot was produced
//
// Idempotent. Safe to re-run / cutover.
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
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS weekly_report_snapshots (
        week_start   date PRIMARY KEY,
        data         jsonb NOT NULL,
        generated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    console.log('\n✓ weekly_report_snapshots ready\n');
  } catch (err) {
    console.error('\n✗ Failed:', err.message);
    throw err;
  } finally {
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });

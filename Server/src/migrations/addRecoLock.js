// Server/src/migrations/addRecoLock.js
// ---------------------------------------------------------------------------
// Weekly Report recommendations become append-only + freezable:
//   weekly_recommendations.locked_at — set when the NEXT week's snapshot
//   publishes (Monday 08:00 VN). Locked notes reject further additions,
//   preserving the historical record.
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
if (!process.argv.includes('--allow-remote') && !(url.includes('localhost') && url.includes('studylink_dev'))) {
  console.error('✗ Refusing to run: DATABASE_URL is not localhost/studylink_dev. Use --allow-remote for a deliberate PROD run.');
  process.exit(1);
}

(async () => {
  try {
    await pool.query(`ALTER TABLE weekly_recommendations ADD COLUMN IF NOT EXISTS locked_at timestamptz`);
    console.log('\n✓ weekly_recommendations.locked_at ready\n');
  } finally { await pool.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });

// server/src/migrations/seedSubagents.js
// Run once: node src/migrations/seedSubagents.js
//
// Adds the `type` column to the subagents contact list and seeds the test
// sample. Idempotent — re-running refreshes type and reactivates by name.
// The full add/edit/CSV-upload admin comes in a later phase; this gives a
// working list to build against now.

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const SAMPLE = [
  { type: 'Agency',                     name: 'Duc Anh EduConnect' },
  { type: 'Agency',                     name: 'Asia-Europe Co., Ltd.' },
  { type: 'Agency',                     name: 'Công ty TNHH Đầu tư Giáo dục' },
  { type: 'Agency',                     name: 'AAA Education Consultancy' },
  { type: 'Banking',                    name: 'Exim Bank' },
  { type: 'Language school',            name: 'Sunwah English School' },
  { type: 'Language tutoring centres',  name: 'Sakura Education and Training Co., Ltd.' },
  { type: 'Full service sub-agent',     name: 'Viet Anh Private School' },
  { type: 'Full service sub-agent',     name: 'Singapore International School' },
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE subagents ADD COLUMN IF NOT EXISTS type VARCHAR(100)`);

    let n = 0;
    for (const s of SAMPLE) {
      await client.query(
        `INSERT INTO subagents (name, type, is_active)
              VALUES ($1, $2, true)
         ON CONFLICT (name) DO UPDATE SET type = EXCLUDED.type, is_active = true`,
        [s.name, s.type]
      );
      n++;
    }
    await client.query('COMMIT');
    console.log(`✓ subagents: type column ensured, ${n} sample sub-agents seeded`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed (rolled back):', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();

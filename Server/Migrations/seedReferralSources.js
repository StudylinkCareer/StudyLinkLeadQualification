// server/src/migrations/seedReferralSources.js
// Run from Server\ :  node src/migrations/seedReferralSources.js
//
// Ensures partners has a `type` column, then seeds the example referral lists:
//   sub-agents → the 4 Agency entries
//   partners   → the 5 typed entries (Banking, Language school, etc.)
// Also deactivates those 5 from subagents (an earlier seed put all 9 there).
// Idempotent — marketing will finalise via the Referral Sources admin.

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const SUBAGENTS = [
  { name: 'Duc Anh EduConnect',              type: 'Agency' },
  { name: 'Asia-Europe Co., Ltd.',           type: 'Agency' },
  { name: 'Công ty TNHH Đầu tư Giáo dục',    type: 'Agency' },
  { name: 'AAA Education Consultancy',        type: 'Agency' },
];
const PARTNERS = [
  { name: 'Exim Bank',                                  type: 'Banking' },
  { name: 'Sunwah English School',                      type: 'Language school' },
  { name: 'Sakura Education and Training Co., Ltd.',     type: 'Language tutoring centres' },
  { name: 'Viet Anh Private School',                    type: 'Full service sub-agent' },
  { name: 'Singapore International School',             type: 'Full service sub-agent' },
];

async function upsert(client, table, name, type) {
  await client.query(
    `INSERT INTO ${table} (name, type, is_active)
     VALUES ($1, $2, true)
     ON CONFLICT (name) DO UPDATE SET type = EXCLUDED.type, is_active = true`,
    [name, type]
  );
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE partners  ADD COLUMN IF NOT EXISTS type VARCHAR(100)`);
    await client.query(`ALTER TABLE subagents ADD COLUMN IF NOT EXISTS type VARCHAR(100)`);

    for (const s of SUBAGENTS) await upsert(client, 'subagents', s.name, s.type);
    for (const p of PARTNERS)  await upsert(client, 'partners',  p.name, p.type);

    // Remove the 5 partners from the sub-agent list if a prior seed placed them there.
    const names = PARTNERS.map(p => p.name);
    const del = await client.query(
      `UPDATE subagents SET is_active = false WHERE name = ANY($1::text[]) AND is_active = true`,
      [names]
    );

    await client.query('COMMIT');
    console.log(`✓ subagents: ${SUBAGENTS.length} seeded`);
    console.log(`✓ partners:  ${PARTNERS.length} seeded`);
    console.log(`✓ moved ${del.rowCount} mis-filed entries out of subagents`);
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

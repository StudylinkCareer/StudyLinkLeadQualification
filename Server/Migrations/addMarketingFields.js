// server/src/migrations/addMarketingFields.js
// Run once: node src/migrations/addMarketingFields.js
//
// PHASE 1 of the Marketing rework. Purely additive + idempotent.
//   1. New marketing columns on students (channel, attendance, type, free-text
//      contact name, subagent) — reusing lead_source / referral_source /
//      campaign_* for the fields that already exist.
//   2. A subagents contact-list table (manual upload, see Phase 2 admin).
//   3. Seeds the fixed lookups: marketing categories, online channels,
//      attendance options, and Client/Staff/Walk-in types.
//
// The Database / Campaign / Event dropdowns are NOT seeded here — they live in
// the Marketing Events admin (lookup_values category='referral_source'), now
// tagged by subcategory. Existing entries are split into those three lists via
// the tagging worksheet / the admin UI.

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const STUDENT_COLUMNS = [
  ['mkt_channel',      'VARCHAR(100)'],   // Online channel: FB Ad / Zalo / ZNS / …
  ['mkt_attendance',   'VARCHAR(50)'],    // Attending / Considering / Not attending
  ['mkt_type',         'VARCHAR(50)'],    // Client / Staff / Walk-in
  ['mkt_contact_name', 'VARCHAR(200)'],   // free-text name (Client/Staff/Walk-in)
  ['mkt_subagent',     'VARCHAR(200)'],   // subagent name (from subagents table)
];

const LOOKUPS = {
  marketing_category: [
    'Databases',
    'FB/Zalo/Google/TikTok/Instagram (Online)',
    'Event',
    'Subagent',
    'Client/Staff/Walk-in',
  ],
  marketing_channel: [
    'FB Ad', 'Zalo', 'ZNS', 'Google Ad', 'LadiPage', 'TikTok', 'Email', 'Facebook', 'Web eBook',
  ],
  marketing_attendance: ['Attending', 'Considering', 'Not attending'],
  client_type: ['Client', 'Staff', 'Walk-in'],
};

// SELECT-then-INSERT seeding (ON CONFLICT is unreliable with the nullable
// subcategory in lookup_values' composite unique key).
async function seedLookup(client, category, codes) {
  let inserted = 0;
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const hit = await client.query(
      `SELECT 1 FROM lookup_values WHERE category = $1 AND COALESCE(subcategory, '') = '' AND code = $2`,
      [category, code]
    );
    if (hit.rowCount === 0) {
      await client.query(
        `INSERT INTO lookup_values (category, code, label_en, label_vi, sort_order, is_active)
         VALUES ($1, $2, $3, $3, $4, true)`,
        [category, code, code, i]
      );
      inserted++;
    }
  }
  console.log(`  ${category}: ${inserted} new, ${codes.length - inserted} existing`);
}

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. students columns
    for (const [col, type] of STUDENT_COLUMNS) {
      await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS ${col} ${type}`);
    }
    console.log(`✓ students: ${STUDENT_COLUMNS.length} marketing columns ensured`);

    // 2. subagents contact list
    await client.query(`
      CREATE TABLE IF NOT EXISTS subagents (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(200) NOT NULL UNIQUE,
        phone      VARCHAR(50),
        email      VARCHAR(200),
        notes      TEXT,
        is_active  BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✓ subagents table ensured');

    // 3. fixed lookups
    console.log('Seeding fixed lookups:');
    for (const [category, codes] of Object.entries(LOOKUPS)) {
      await seedLookup(client, category, codes);
    }

    await client.query('COMMIT');
    console.log('\n✓ Marketing Phase 1 migration complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed (rolled back):', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

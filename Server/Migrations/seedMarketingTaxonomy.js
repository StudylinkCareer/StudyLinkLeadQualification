// server/src/migrations/seedMarketingTaxonomy.js
// Run once: node src/migrations/seedMarketingTaxonomy.js
//
// Seeds the marketing Category → Sub-category taxonomy into lookup_values:
//   marketing_category    : the categories      (subcategory column = NULL)
//   marketing_subcategory : the values, each tagged with its parent category
//                           in the subcategory column
//
// Reconciling + idempotent: every existing marketing_category /
// marketing_subcategory row is deactivated first, then the set below is
// (re)activated — so removing a value here deactivates it on the next run.
// label_en / label_vi default to the code; edit later for localisation.

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// NOTE: "Client" was given as "Click" — read as a typo. Change here if intended.
const TAXONOMY = {
  'Database':                                 ['YOOTEDU', 'WISE'],
  'FB/Zalo/Google/TikTok/Instagram (Online)': ['Facebook', 'Zalo', 'Google', 'Tik Tok', 'Instagram', 'StudyLink Hotline', 'Email', 'Digital'],
  'Event':                                    ['School Outreach', 'Partner event'],
  'Client/Staff/Walk-in':                     ['Client', 'Staff', 'Walk-in'],
  'Campaign':                                 ['Studylink Fairs', 'Partner Seminars'],
};

async function upsert(client, category, subcategory, code, sort) {
  const hit = await client.query(
    `SELECT id FROM lookup_values
      WHERE category = $1 AND COALESCE(subcategory, '') = COALESCE($2, '') AND code = $3`,
    [category, subcategory, code]
  );
  if (hit.rowCount > 0) {
    await client.query(
      `UPDATE lookup_values
          SET is_active = true, sort_order = $1, label_en = $2, label_vi = $2
        WHERE id = $3`,
      [sort, code, hit.rows[0].id]
    );
  } else {
    await client.query(
      `INSERT INTO lookup_values (category, subcategory, code, label_en, label_vi, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $4, $5, true)`,
      [category, subcategory, code, code, sort]
    );
  }
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Deactivate the whole taxonomy first, then re-activate the set below.
    await client.query(
      `UPDATE lookup_values SET is_active = false
        WHERE category IN ('marketing_category', 'marketing_subcategory')`
    );

    let ci = 0;
    for (const [cat, subs] of Object.entries(TAXONOMY)) {
      await upsert(client, 'marketing_category', null, cat, ci++);
      let si = 0;
      for (const sub of subs) {
        await upsert(client, 'marketing_subcategory', cat, sub, si++);
      }
      console.log(`  ${cat}: ${subs.length} sub-categories`);
    }

    await client.query('COMMIT');
    console.log(`\n✓ Marketing taxonomy seeded: ${ci} categories`);
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

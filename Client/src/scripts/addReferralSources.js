// scripts/addReferralSources.js
// ─────────────────────────────────────────────────────────────────────
// Seeds initial marketing events into lookup_values, category='referral_source'.
// Each row represents a specific marketing event/visit a student attended.
//
// Storage shape:
//   category    = 'referral_source'
//   code        = canonical event name (stored on the lead record)
//   label_en    = English display
//   label_vi    = Vietnamese display
//   sort_order  = display order (ASC = earliest event first)
//
// New events can be added via the Marketing Events admin page in LM
// (POST /api/marketing-events). sort_order auto-increments.
//
// Idempotent: ON CONFLICT updates existing rows in place.
//
// Usage:
//   node scripts/addReferralSources.js
// ─────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const SEED_EVENTS = [
  { code: 'Viet Anh School visit',          labelEn: 'Viet Anh School visit',         labelVi: 'Tham quan trường Việt Anh' },
  { code: 'Top Universities 2026',          labelEn: 'Top Universities 2026',         labelVi: 'Top Universities 2026' },
  { code: 'Singapore International School', labelEn: 'Singapore International School', labelVi: 'Trường Quốc tế Singapore' },
];

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  console.log(`Connecting to ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`Seeding ${SEED_EVENTS.length} marketing events...\n`);

  const client = await pool.connect();
  let inserted = 0, updated = 0;
  try {
    await client.query('BEGIN');
    for (let i = 0; i < SEED_EVENTS.length; i++) {
      const e = SEED_EVENTS[i];
      const res = await client.query(
        `INSERT INTO lookup_values (category, code, label_en, label_vi, sort_order)
         VALUES ('referral_source', $1, $2, $3, $4)
         ON CONFLICT (category, COALESCE(subcategory, ''), code) DO UPDATE
           SET label_en   = EXCLUDED.label_en,
               label_vi   = EXCLUDED.label_vi,
               sort_order = EXCLUDED.sort_order
         RETURNING (xmax = 0) AS inserted`,
        [e.code, e.labelEn, e.labelVi, i]
      );
      if (res.rows[0].inserted) inserted++; else updated++;
    }
    await client.query('COMMIT');
    console.log(`✓ Done. ${inserted} inserted, ${updated} updated.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

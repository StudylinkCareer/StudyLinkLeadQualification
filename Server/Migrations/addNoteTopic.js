// server/src/migrations/addNoteTopic.js
// Run once: node src/migrations/addNoteTopic.js

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const TOPICS = [
  { code: 'General',                   labelEn: 'General',                   sortOrder: 10 },
  { code: 'First Meeting',             labelEn: 'First Meeting',             sortOrder: 20 },
  { code: 'Basic Counselling Letter',  labelEn: 'Basic Counselling Letter',  sortOrder: 30 },
  { code: 'Second Meeting',            labelEn: 'Second Meeting',            sortOrder: 40 },
  { code: 'Final Counselling Letter',  labelEn: 'Final Counselling Letter',  sortOrder: 50 },
  { code: 'Office Visit',              labelEn: 'Office Visit',              sortOrder: 60 },
  { code: 'Contract',                  labelEn: 'Contract',                  sortOrder: 70 },
  { code: 'Handover to CO',            labelEn: 'Handover to CO',            sortOrder: 80 },
];

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Add topic column to student_notes
    await client.query(`
      ALTER TABLE student_notes
        ADD COLUMN IF NOT EXISTS topic VARCHAR(100)
    `);

    // Seed note_topic lookup values.
    // We avoid ON CONFLICT because subcategory is nullable and may not be
    // part of the unique index. Instead we check existence first.
    for (const t of TOPICS) {
      const existing = await client.query(
        `SELECT id FROM lookup_values WHERE category = 'note_topic' AND code = $1`,
        [t.code]
      );
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO lookup_values (category, code, label_en, sort_order, is_active)
           VALUES ('note_topic', $1, $2, $3, true)`,
          [t.code, t.labelEn, t.sortOrder]
        );
        console.log('  Inserted:', t.code);
      } else {
        console.log('  Already exists, skipping:', t.code);
      }
    }

    await client.query('COMMIT');
    console.log('✅  addNoteTopic migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

// server/src/migrations/addMeetingLocation.js
// Run once from the Server directory: node src/migrations/addMeetingLocation.js
//
// 1) Adds student_notes.meeting_location (for the Weekly Report "Meetings - where").
// 2) Seeds the meeting_location lookup values (Office / Conference call / Online).

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const LOCATIONS = [
  { code: 'Office',          labelEn: 'Office',          sortOrder: 10 },
  { code: 'Conference call', labelEn: 'Conference call', sortOrder: 20 },
  { code: 'Online',          labelEn: 'Online',          sortOrder: 30 },
];

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE student_notes
        ADD COLUMN IF NOT EXISTS meeting_location VARCHAR(50)
    `);

    // SELECT-then-INSERT (subcategory nullable, not safe for ON CONFLICT).
    for (const l of LOCATIONS) {
      const existing = await client.query(
        `SELECT id FROM lookup_values WHERE category = 'meeting_location' AND code = $1`,
        [l.code]
      );
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO lookup_values (category, code, label_en, sort_order, is_active)
           VALUES ('meeting_location', $1, $2, $3, true)`,
          [l.code, l.labelEn, l.sortOrder]
        );
        console.log('  Inserted:', l.code);
      } else {
        console.log('  Already exists, skipping:', l.code);
      }
    }

    await client.query('COMMIT');
    console.log('\u2705  addMeetingLocation migration complete.');
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

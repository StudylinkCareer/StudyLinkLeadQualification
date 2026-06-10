// server/src/migrations/addReminderColumns.js
// Run once: node src/migrations/addReminderColumns.js
//
// Adds three columns to student_notes to support the reminder system:
//   follow_up_date    DATE         – the scheduled follow-up date
//   reminder_status   VARCHAR(20)  – 'active' | 'closed' | 'rescheduled'
//   rescheduled_date  DATE         – populated only when status = 'rescheduled'
//   contact_platform  VARCHAR(30)  – platform used (Phone, SMS, Zalo, etc.)
//                                    extracted from ContactLogModal so we can
//                                    aggregate comms analytics without parsing
//                                    free-text content.

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Add columns if they don't already exist (idempotent)
    await client.query(`
      ALTER TABLE student_notes
        ADD COLUMN IF NOT EXISTS follow_up_date   DATE,
        ADD COLUMN IF NOT EXISTS reminder_status  VARCHAR(20) DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS rescheduled_date DATE,
        ADD COLUMN IF NOT EXISTS contact_platform VARCHAR(30)
    `);

    // Index for the reminders query (scans by follow_up_date + status)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_notes_followup
        ON student_notes (follow_up_date, reminder_status)
        WHERE follow_up_date IS NOT NULL
    `);

    // Index for communications analytics (scans by created_at range)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_notes_created
        ON student_notes (created_at, note_type)
    `);

    await client.query('COMMIT');
    console.log('✅  Migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

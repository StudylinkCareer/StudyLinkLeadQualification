// Throwaway script to pull the registrant list for the post-event survey send.
// Read-only. Modes:
//   node scripts/getEventRegistrants.js               -> lists recent events (id, name, dates, registered count)
//                                                          so you can find the right event id
//   node scripts/getEventRegistrants.js <eventId>      -> writes a CSV of every registrant's
//                                                          name/email/phone for that event,
//                                                          regardless of status/attendance
//   node scripts/getEventRegistrants.js <eventId> --split
//                                                      -> writes TWO CSVs instead of one:
//                                                         event_<id>_batch1_confirmed.csv
//                                                           (lead_events.status = 'Confirmed'
//                                                           OR event_attendees.attended_at is set)
//                                                         event_<id>_batch2_rest.csv
//                                                           (everyone else: Uncertain/Declined/
//                                                           no status, and never checked in)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Pass it inline, e.g.: DATABASE_URL="..." node scripts/getEventRegistrants.js');
  process.exit(1);
}
console.log('Connecting to host:', url.replace(/.*@/, '').split('/')[0]);

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
const eventId = process.argv[2];
const split = process.argv[3] === '--split';

const outDir = path.join(__dirname, 'output');
const esc = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
function writeCsv(outPath, rows) {
  fs.mkdirSync(outDir, { recursive: true });
  const csv = 'full_name,email,phone\n'
    + rows.map((row) => [row.full_name, row.email, row.phone].map(esc).join(',')).join('\n');
  fs.writeFileSync(outPath, csv, 'utf8');
  console.log(`Written ${rows.length} rows to:`, outPath);
}

(async () => {
  if (!eventId) {
    const r = await pool.query(`
      SELECT e.id, e.name, e.start_date, e.end_date, COUNT(le.id) AS registered
        FROM events e
        LEFT JOIN lead_events le ON le.event_id = e.id
       GROUP BY e.id, e.name, e.start_date, e.end_date
       ORDER BY e.start_date DESC NULLS LAST
       LIMIT 30
    `);
    console.table(r.rows);
    console.log('\nFound the event? Re-run: node scripts/getEventRegistrants.js <id> [--split]');
    await pool.end();
    return;
  }

  if (!split) {
    const r = await pool.query(`
      SELECT DISTINCT s.full_name, s.email, s.phone
        FROM lead_events le
        JOIN students s ON s.student_id = le.student_id
       WHERE le.event_id = $1
         AND s.email IS NOT NULL AND s.email <> ''
    `, [eventId]);
    console.log(`Found ${r.rows.length} registrants with an email on file.`);
    writeCsv(path.join(outDir, `event_${eventId}_registrants.csv`), r.rows);
    await pool.end();
    return;
  }

  const base = `
    FROM lead_events le
    JOIN students s ON s.student_id = le.student_id
    LEFT JOIN event_attendees ea ON ea.event_id = le.event_id AND ea.student_unique_id = s.student_id
   WHERE le.event_id = $1
     AND s.email IS NOT NULL AND s.email <> ''
  `;
  const engaged = await pool.query(`
    SELECT DISTINCT s.full_name, s.email, s.phone ${base}
       AND (le.status = 'Confirmed' OR ea.attended_at IS NOT NULL)
  `, [eventId]);
  const rest = await pool.query(`
    SELECT DISTINCT s.full_name, s.email, s.phone ${base}
       AND NOT (le.status = 'Confirmed' OR ea.attended_at IS NOT NULL)
  `, [eventId]);

  console.log(`Batch 1 (confirmed/attended): ${engaged.rows.length}`);
  console.log(`Batch 2 (rest): ${rest.rows.length}`);
  writeCsv(path.join(outDir, `event_${eventId}_batch1_confirmed.csv`), engaged.rows);
  writeCsv(path.join(outDir, `event_${eventId}_batch2_rest.csv`), rest.rows);
  await pool.end();
})().catch((e) => {
  console.error('Query failed:', e.message);
  process.exit(1);
});

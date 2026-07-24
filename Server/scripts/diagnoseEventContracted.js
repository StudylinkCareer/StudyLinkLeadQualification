// Read-only diagnostic — shows exactly which registrants of an event are
// being counted as "Contracted" by eventSourceBreakdown.js, and why, so a
// wrong-looking count can be traced back to real data instead of guessed at.
// Usage: node scripts/diagnoseEventContracted.js <eventId>
require('dotenv').config();
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set in the environment.');
  process.exit(1);
}
console.log('Connecting to host:', url.replace(/.*@/, '').split('/')[0]);

const eventId = parseInt(process.argv[2], 10);
if (isNaN(eventId)) {
  console.error('Usage: node scripts/diagnoseEventContracted.js <eventId>');
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

(async () => {
  const evRes = await pool.query('SELECT id, name, start_date FROM events WHERE id = $1', [eventId]);
  if (!evRes.rows.length) { console.error('No event with id', eventId); process.exit(1); }
  const event = evRes.rows[0];
  console.log(`Event: ${event.name} (id ${event.id}), start_date = ${event.start_date}`);
  console.log('---');

  const { rows } = await pool.query(
    `SELECT le.student_id, s.full_name, le.created_at AS registered_for_event_at,
            rl.lead_id, rl.lead_status, rl.close_date, rl.actual_close_date, rl.created_at AS lead_created_at
       FROM (SELECT DISTINCT ON (student_id, event_id) * FROM lead_events
              WHERE event_id = $1 ORDER BY student_id, event_id, created_at ASC) le
       JOIN students s ON s.student_id = le.student_id
       LEFT JOIN LATERAL (
             SELECT lead_id, lead_status, close_date, actual_close_date, created_at
               FROM leads
              WHERE person_id = le.student_id
              ORDER BY (lead_status NOT IN ('Contracted','Lost','Archived')) DESC, lead_id DESC
              LIMIT 1
            ) rl ON true
      WHERE rl.lead_status = 'Contracted'
      ORDER BY le.student_id`,
    [eventId]
  );

  if (!rows.length) {
    console.log('No registrant currently has a Contracted representative lead at all.');
  } else {
    console.log(`${rows.length} registrant(s) whose REPRESENTATIVE lead is Contracted:\n`);
    for (const r of rows) {
      const countedByEventDate = r.actual_close_date != null && new Date(r.actual_close_date) >= new Date(event.start_date);
      const countedByRegDate = r.actual_close_date != null && r.registered_for_event_at != null
        && new Date(r.actual_close_date) >= new Date(r.registered_for_event_at);
      console.log(
        `student_id=${r.student_id}  name=${r.full_name}\n` +
        `  lead_id=${r.lead_id}  close_date=${r.close_date}  actual_close_date=${r.actual_close_date}  lead_created_at=${r.lead_created_at}\n` +
        `  registered_for_THIS_event_at=${r.registered_for_event_at}\n` +
        `  -> counted vs event.start_date? ${countedByEventDate ? 'YES' : 'no'}   counted vs own registration timestamp? ${countedByRegDate ? 'YES' : 'no'}\n`
      );
    }
  }

  // Also show: does this student have OTHER leads besides the representative one?
  // (helps spot the "many unrelated leads per Sale" case directly)
  const multiRes = await pool.query(
    `SELECT person_id, COUNT(*)::int AS lead_count,
            STRING_AGG(lead_id || ':' || lead_status, ', ' ORDER BY lead_id) AS leads
       FROM leads
      WHERE person_id IN (SELECT student_id FROM lead_events WHERE event_id = $1)
      GROUP BY person_id
     HAVING COUNT(*) > 1`,
    [eventId]
  );
  if (multiRes.rows.length) {
    console.log('--- Registrants with MORE THAN ONE lead row (possible cross-attribution) ---');
    for (const r of multiRes.rows) {
      console.log(`${r.person_id}: ${r.lead_count} leads -> ${r.leads}`);
    }
  }

  await pool.end();
})().catch((e) => {
  console.error('Query failed:', e.message);
  process.exit(1);
});

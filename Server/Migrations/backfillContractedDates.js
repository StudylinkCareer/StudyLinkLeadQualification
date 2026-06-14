// Server/src/migrations/backfillContractedDates.js
//
// One-time backfill so the Dashboard "Contracted" period metrics (last week /
// month / quarter / year to-date) have a transition date for leads that were
// ALREADY in status 'Contracted' before status logging existed (e.g. imported
// leads). For each such lead with no 'leadStatus -> Contracted' row in
// audit_log, we insert one synthetic row so the metric (which reads audit_log)
// can bucket it into the right period.
//
// Date used (first non-null wins):  close_date -> updated_at -> created_at
// change_source = 'backfill', changed_by = 'backfill_script'
//
// Usage (run from the Server directory so dotenv finds .env):
//   cd C:\Users\rhod_\Documents\StudyLinkLeadQualification\Server
//   node src\migrations\backfillContractedDates.js            (dry-run)
//   node src\migrations\backfillContractedDates.js --apply     (write)

require('dotenv').config();
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

function pickDate(r) {
  if (r.close_date) return { date: r.close_date, source: 'close_date' };
  if (r.updated_at) return { date: r.updated_at, source: 'updated_at' };
  if (r.created_at) return { date: r.created_at, source: 'created_at' };
  return { date: null, source: 'none' };
}

async function main() {
  const { rows } = await pool.query(`
    SELECT s.unique_id, s.full_name, s.close_date, s.updated_at, s.created_at
      FROM students s
     WHERE s.lead_status = 'Contracted'
       AND NOT EXISTS (
         SELECT 1 FROM audit_log a
          WHERE a.student_id = s.unique_id
            AND a.field_name = 'leadStatus'
            AND a.new_value  = 'Contracted'
       )
     ORDER BY s.unique_id
  `);

  console.log(`Found ${rows.length} Contracted lead(s) without a transition row.\n`);
  const plan = rows.map(r => ({ ...r, ...pickDate(r) }));
  for (const p of plan) {
    const d = p.date ? new Date(p.date).toISOString().slice(0, 10) : '(no date - will skip)';
    console.log(`  ${p.unique_id}  ${d}  [${p.source}]  ${p.full_name || ''}`);
  }

  const usable = plan.filter(p => p.date);
  console.log(`\n${usable.length} will be backfilled, ${plan.length - usable.length} skipped (no date).`);

  if (!APPLY) {
    console.log('\nDry-run only. Re-run with --apply to write these rows.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let done = 0;
  try {
    await client.query('BEGIN');
    for (const p of usable) {
      await client.query(
        `INSERT INTO audit_log
           (student_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
         VALUES ($1, 'backfill_script', $2, 'leadStatus', '', 'Contracted', 'backfill')`,
        [p.unique_id, p.date]
      );
      done++;
    }
    await client.query('COMMIT');
    console.log(`\n\u2713 Backfilled ${done} row(s) into audit_log.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('FATAL, rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

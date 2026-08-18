// Auto-close open reminders when their lead reaches a terminal status
// (confirmed 2026-08).
//
// A comment in staffController.js's stale-reminder maintenance tool
// ("Admin Maintenance -> Stale Reminders") claimed this already happened
// ("The trigger auto-closes reminders on a Lead's status change") — it
// didn't. No such trigger existed anywhere in the database. That's the
// real root cause behind thousands of open reminders sitting on leads that
// had already gone Lost/Archived/Cancelled/Contracted: nothing was ever
// closing them, so they just accumulated and kept showing up in Sales
// Followup (and Access-Denied'ing whoever clicked through, once the lead
// had also been reassigned away).
//
// This trigger is the going-forward fix — it stops NEW stale reminders
// from accumulating the moment a lead's status actually changes, rather
// than relying on someone remembering to run the manual cleanup tool.
// 'Not contactable' is deliberately NOT included — per orderPhase.js's
// ACTIVE_STATUSES list, that status is still legitimately being worked
// (it's an ongoing "trying to reach them" state, not a dead end), so its
// reminders should stay open. The four terminal statuses here match the
// OPEN definition already used consistently in staffController.js.
//
// Idempotent (CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS).
// Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addReminderAutoCloseTrigger.js
//   PROD: node src/migrations/addReminderAutoCloseTrigger.js --allow-remote
require('dotenv').config();
const { Pool } = require('pg');

const url  = process.env.DATABASE_URL || '';
const host = (url.split('@')[1] || '').split('/')[0] || '(unknown)';
const isLocal     = /localhost|127\.0\.0\.1|studylink_dev/.test(url);
const allowRemote = process.argv.includes('--allow-remote');

if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!isLocal && !allowRemote) {
  console.error(`Refusing to run against non-local DB (${host}) without --allow-remote`);
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

(async () => {
  console.log('Target DB host: ' + host);

  await pool.query(`
    CREATE OR REPLACE FUNCTION close_reminders_on_lead_status_change()
    RETURNS TRIGGER AS $$
    BEGIN
      UPDATE student_notes
         SET reminder_status = 'closed'
       WHERE lead_id = NEW.lead_id
         AND follow_up_date IS NOT NULL
         AND reminder_status <> 'closed';
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await pool.query(`DROP TRIGGER IF EXISTS trg_close_reminders_on_lead_status_change ON leads`);
  await pool.query(`
    CREATE TRIGGER trg_close_reminders_on_lead_status_change
      AFTER UPDATE OF lead_status ON leads
      FOR EACH ROW
      WHEN (NEW.lead_status IS DISTINCT FROM OLD.lead_status
            AND NEW.lead_status IN ('Contracted', 'Lost', 'Archived', 'Cancelled'))
      EXECUTE FUNCTION close_reminders_on_lead_status_change();
  `);

  const check = await pool.query(`
    SELECT COUNT(*)::int AS trigger_exists
      FROM information_schema.triggers
     WHERE event_object_table = 'leads'
       AND trigger_name = 'trg_close_reminders_on_lead_status_change'
  `);
  console.log('Expect trigger_exists=1:', check.rows[0]);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

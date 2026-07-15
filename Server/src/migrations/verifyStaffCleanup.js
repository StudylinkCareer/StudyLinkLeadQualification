// Server/src/migrations/verifyStaffCleanup.js — READ-ONLY verification of the
// 15 Jul 2026 staff consolidation. Prints checks; writes nothing.
//   node src/migrations/verifyStaffCleanup.js --allow-remote
require('dotenv').config();
const { Pool } = require('pg');

const url = process.env.DATABASE_URL || '';
const host = (url.match(/@([^:@/]+)/) || [])[1] || '(?)';
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
if (!isLocal && !process.argv.includes('--allow-remote')) {
  console.error(`ABORT: non-local host "${host}". Use --allow-remote.`);
  process.exit(1);
}
const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

(async () => {
  const one = async (sql) => (await pool.query(sql)).rows;
  console.log(`Host: ${host}\n`);

  console.log('Staff rows total:', (await one(`SELECT count(*)::int n FROM staff`))[0].n);
  console.log('Visible in Staff list (excl. hidden event-type):',
    (await one(`SELECT count(*)::int n FROM staff WHERE COALESCE(staff_type,'') <> 'event'`))[0].n);

  const dups = await one(`
    SELECT lower(trim(full_name)) nm, count(*) c FROM staff
     WHERE COALESCE(staff_type,'') <> 'event'
     GROUP BY 1 HAVING count(*) > 1`);
  console.log('Duplicate visible names:', dups.length ? JSON.stringify(dups) : 'none ✓');

  console.log('Orphan roster links:',
    (await one(`SELECT count(*)::int n FROM event_reps er LEFT JOIN staff s ON s.id = er.staff_id WHERE s.id IS NULL`))[0].n, '(want 0)');

  console.log('Leftover evt-…@reps.local logins:',
    (await one(`SELECT count(*)::int n FROM staff WHERE email LIKE 'evt-%@reps.local'`))[0].n, '(want 0)');

  const execs = await one(`SELECT id, full_name FROM staff WHERE role = 'Executive' ORDER BY id`);
  console.log('Executive-tier accounts:', execs.map(x => `#${x.id} ${x.full_name}`).join(', '));

  const evt = await one(`
    SELECT id, full_name, email, is_active,
           to_char(access_valid_from AT TIME ZONE 'Asia/Ho_Chi_Minh', 'MM-DD HH24:MI') f,
           to_char(access_valid_until AT TIME ZONE 'Asia/Ho_Chi_Minh', 'MM-DD HH24:MI') u
      FROM staff WHERE position = 'StudyLink event staff' ORDER BY full_name`);
  console.log(`\nStudyLink event staff (${evt.length}):`);
  evt.forEach(x => console.log(`  #${x.id} ${x.full_name} <${x.email}> ${x.is_active ? '' : 'INACTIVE '}window ${x.f || '—'} -> ${x.u || '—'}`));

  const roster = await one(`
    SELECT s.full_name FROM event_reps er JOIN staff s ON s.id = er.staff_id
     WHERE er.event_id = 36 AND er.is_active ORDER BY s.full_name`);
  console.log(`\nActive roster, event 36 (${roster.length}):`);
  roster.forEach(x => console.log('  ' + x.full_name));

  await pool.end();
})().catch(e => { console.error('✗', e.message); process.exit(1); });

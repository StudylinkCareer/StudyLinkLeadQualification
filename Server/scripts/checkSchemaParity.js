// Server/scripts/checkSchemaParity.js
// Read-only. Prints key schema/data markers so you can compare local dev vs PROD.
//   node scripts/checkSchemaParity.js                       # uses .env DATABASE_URL (dev)
//   $env:DATABASE_URL="<prod>"; $env:NODE_ENV="production"; node scripts/checkSchemaParity.js   # prod
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const one = (r) => (r.rows.length === 1 && Object.keys(r.rows[0]).length === 1)
  ? Object.values(r.rows[0])[0] : r.rows;

async function q(label, sql) {
  try { return [label, one(await pool.query(sql))]; }
  catch (e) { return [label, 'ERR: ' + e.message]; }
}

(async () => {
  const checks = await Promise.all([
    q('current database',              `SELECT current_database() AS v`),
    q('students tables (schema.table)',`SELECT COALESCE(string_agg(table_schema||'.'||table_name,', '),'(none)') AS v FROM information_schema.tables WHERE table_name='students'`),
    q('leads table exists',            `SELECT to_regclass('public.leads') IS NOT NULL AS v`),
    q('applications table exists',     `SELECT to_regclass('public.applications') IS NOT NULL AS v`),
    q('students.student_id col',       `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='students' AND column_name='student_id') AS v`),
    q('PUBLIC.students staff cols',    `SELECT COALESCE(string_agg(column_name,','),'(none)') AS v FROM information_schema.columns WHERE table_schema='public' AND table_name='students' AND column_name IN ('counselor','senior_counselor','presales','marketing_staff')`),
    q('lead_status lookup',            `SELECT COALESCE(string_agg(code,',' ORDER BY sort_order),'(none)') AS v FROM lookup_values WHERE category='lead_status'`),
    q('leads.cancellation_date col',   `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='cancellation_date') AS v`),
    q('cancel trigger has Cancelled',  `SELECT position('Cancelled' in pg_get_functiondef('leads_stamp_close_dates()'::regprocedure)) > 0 AS v`),
    q('event_attendees zalo cols',     `SELECT COALESCE(string_agg(column_name,','),'(none)') AS v FROM information_schema.columns WHERE table_name='event_attendees' AND column_name LIKE 'badge_zalo%'`),
    q('students row count',            `SELECT count(*)::int AS v FROM students`),
    q('leads row count',               `SELECT count(*)::int AS v FROM leads`),
  ]);
  const masked = (process.env.DATABASE_URL || '(none)').replace(/:\/\/[^:]+:[^@]+@/, '://****:****@');
  console.log('\n=== markers for', masked, '===');
  for (const [label, val] of checks) console.log('  ' + String(label).padEnd(32), val);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

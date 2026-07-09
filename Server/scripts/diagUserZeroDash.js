// scripts/diagUserZeroDash.js — READ-ONLY. Why do specific users see an empty
// dashboard / leads list? Reproduces the searchLeads scope='own' gate per user.
require('dotenv').config();
const { Pool } = require('pg');
const { phaseForPosition } = require('../src/utils/orderPhase');

const url = process.env.DATABASE_URL || '';
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
const CLOSED = ['Lost', 'Archived', 'Cancelled'];

const NAMES = [
  'Mạch Nguyễn Phi Vân',
  'Phạm Vũ Kim Chi',
  'Phạm Thị Ngọc Viên',
];

(async () => {
  console.log('Host:', (url.match(/@([^:@/]+)/) || [])[1] || '(?)', '\n');

  for (const name of NAMES) {
    console.log('════════════════════════════════════════════════════════');
    console.log('STAFF:', name);

    const st = await pool.query(
      `SELECT full_name, position, role, is_active, staff_type
         FROM staff WHERE full_name = $1 ORDER BY COALESCE(staff_type,'') <> 'event', is_active DESC`,
      [name]
    );
    if (!st.rows.length) { console.log('  !! no staff row'); continue; }
    st.rows.forEach(r => console.log(
      `  row: position=${JSON.stringify(r.position)} role=${JSON.stringify(r.role)} active=${r.is_active} type=${r.staff_type || ''}`));

    const primary = st.rows[0];
    const myPhase = phaseForPosition(primary.position);
    console.log(`  => session position=${JSON.stringify(primary.position)}  myPhase=${JSON.stringify(myPhase)}`);

    // leads.view_list scope for their role
    const sc = await pool.query(
      `SELECT scope FROM role_permissions WHERE role=$1 AND resource='leads' AND operation='view_list'`,
      [primary.role]
    );
    const scope = sc.rows[0]?.scope || 'none';
    console.log(`  leads.view_list scope for role ${JSON.stringify(primary.role)} = ${JSON.stringify(scope)}`);

    // All leads assigned to them in ANY staff column (isLeadAssignedTo), joined to order phase.
    const asg = await pool.query(
      `SELECT COALESCE(s.order_phase,'Pool') AS phase, l.lead_status,
              (l.counselor=$1) AS c, (l.senior_counselor=$1) AS sc,
              (l.presales=$1) AS ps, (l.marketing_staff=$1) AS ms
         FROM leads l JOIN students s ON s.student_id = l.person_id
        WHERE l.counselor=$1 OR l.senior_counselor=$1 OR l.presales=$1 OR l.marketing_staff=$1`,
      [name]
    );
    const rows = asg.rows;
    const visible = rows.filter(r => r.phase === myPhase && !CLOSED.includes(r.lead_status));
    console.log(`  assigned leads (any column): ${rows.length}`);

    const byCol = { counselor: 0, senior: 0, presales: 0, marketing: 0 };
    rows.forEach(r => { if (r.c) byCol.counselor++; if (r.sc) byCol.senior++; if (r.ps) byCol.presales++; if (r.ms) byCol.marketing++; });
    console.log(`    by column: ${JSON.stringify(byCol)}`);

    const byPhase = {};
    rows.forEach(r => { byPhase[r.phase] = (byPhase[r.phase] || 0) + 1; });
    console.log(`    by order_phase: ${JSON.stringify(byPhase)}`);

    console.log(`  >>> VISIBLE on own dashboard (phase===${JSON.stringify(myPhase)} & not closed): ${visible.length}`);
    if (scope === 'all') console.log('  (role scope is ALL — should NOT be phase-gated; sees everything)');
  }
  console.log('════════════════════════════════════════════════════════');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });

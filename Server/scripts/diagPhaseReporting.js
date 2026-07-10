// scripts/diagPhaseReporting.js — READ-ONLY. Verify the per-phase reporting rule
// (orderPhase.isReportableStatus) against real per-owner counts. Usage:
//   node scripts/diagPhaseReporting.js "Trần Thị Huyền Trang"
require('dotenv').config();
const { Pool } = require('pg');
const { phaseForPosition, isReportableStatus } = require('../src/utils/orderPhase');
const url = process.env.DATABASE_URL || '';
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
const NAME = process.argv[2] || 'Trần Thị Huyền Trang';

(async () => {
  console.log('Host:', (url.match(/@([^:@/]+)/) || [])[1] || '(?)');
  const st = await pool.query(`SELECT position FROM staff WHERE full_name=$1 AND COALESCE(staff_type,'')<>'event' LIMIT 1`, [NAME]);
  const myPhase = phaseForPosition(st.rows[0]?.position);
  console.log(`COUNSELOR: ${NAME}  position=${st.rows[0]?.position}  phase=${myPhase}\n`);

  // Grouped by their in-phase orders (matches Dashboard: group by l.counselor, gate on order_phase).
  const r = await pool.query(
    `SELECT COALESCE(NULLIF(l.lead_status,''),'New') AS status, COUNT(*)::int n
       FROM leads l JOIN students s ON s.student_id = l.person_id
      WHERE l.counselor = $1 AND s.order_phase = $2
      GROUP BY 1 ORDER BY 1`,
    [NAME, myPhase]
  );
  let reported = 0, notReported = 0, total = 0;
  for (const row of r.rows) {
    total += row.n;
    if (isReportableStatus(myPhase, row.status)) reported += row.n; else notReported += row.n;
    console.log(`   ${row.status.padEnd(32)} ${String(row.n).padStart(4)}  ${isReportableStatus(myPhase,row.status)?'✓ reported':'· not reported'}`);
  }
  console.log(`\n  Dashboard bar (reported) = ${reported}`);
  console.log(`  Not reported             = ${notReported}`);
  console.log(`  Total in ${myPhase} phase    = ${total}   (should match Leads-list count)`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });

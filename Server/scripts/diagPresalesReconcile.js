// scripts/diagPresalesReconcile.js — READ-ONLY. Reconcile Leads-list count vs
// Dashboard "Leads by Pre-Sales" attribution for one counselor.
require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL || '';
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

const NAME = process.argv[2] || 'Trần Thị Huyền Trang';
// Mirrors Dashboard.jsx REPORTING_INCLUDED_STATUSES (Presales uses the same set).
const REPORTABLE = new Set([
  'New', 'Engaged', 'Contracted', 'Proposal',
  'Met with customer and family', 'Vetted', 'Family negotiation/review',
  'Nurturing', 'Not contactable',
]);

(async () => {
  console.log('Host:', (url.match(/@([^:@/]+)/) || [])[1] || '(?)');
  console.log('COUNSELOR:', NAME, '\n');

  // The Dashboard groups Pre-Sales by l.counselor (lead-level). searchLeads =
  // SELECT s.*, l.* so orderPhase = s.order_phase, status = l.lead_status.
  const r = await pool.query(
    `SELECT COALESCE(s.order_phase,'(null)') AS phase,
            COALESCE(NULLIF(l.lead_status,''),'(blank)') AS status,
            COUNT(*)::int AS n
       FROM leads l JOIN students s ON s.student_id = l.person_id
      WHERE l.counselor = $1
      GROUP BY 1,2 ORDER BY 1,2`,
    [NAME]
  );

  let total = 0, attributable = 0;
  const byPhase = {}, byStatus = {};
  const droppedPhase = {}, droppedStatus = {};
  for (const row of r.rows) {
    total += row.n;
    byPhase[row.phase] = (byPhase[row.phase] || 0) + row.n;
    byStatus[row.status] = (byStatus[row.status] || 0) + row.n;
    const phaseOk = row.phase === 'Presales';
    const statusOk = REPORTABLE.has(row.status);
    if (phaseOk && statusOk) attributable += row.n;
    else {
      if (!phaseOk) droppedPhase[row.phase] = (droppedPhase[row.phase] || 0) + row.n;
      else if (!statusOk) droppedStatus[row.status] = (droppedStatus[row.status] || 0) + row.n;
    }
  }

  console.log('TOTAL leads with counselor =', NAME, '→', total, '  (Leads-list count)');
  console.log('\nby order_phase:'); Object.entries(byPhase).sort().forEach(([k,v]) => console.log('   ', k.padEnd(14), v));
  console.log('\nby lead_status:'); Object.entries(byStatus).sort().forEach(([k,v]) => console.log('   ', k.padEnd(32), v));
  console.log('\n>>> attributableTo(Presales) =', attributable, '  (Dashboard bar)');
  console.log('\nDROPPED — wrong phase (not Presales):', Object.values(droppedPhase).reduce((a,b)=>a+b,0));
  Object.entries(droppedPhase).sort().forEach(([k,v]) => console.log('     ', k.padEnd(14), v));
  console.log('DROPPED — Presales phase but non-reportable status:', Object.values(droppedStatus).reduce((a,b)=>a+b,0));
  Object.entries(droppedStatus).sort().forEach(([k,v]) => console.log('     ', k.padEnd(32), v));

  // Sanity: her staff position + is she also in the presales column anywhere?
  const st = await pool.query(`SELECT position, role, is_active FROM staff WHERE full_name=$1`, [NAME]);
  console.log('\nstaff:', JSON.stringify(st.rows));
  const psCol = await pool.query(`SELECT COUNT(*)::int n FROM leads WHERE presales=$1`, [NAME]);
  console.log('leads where she is in the PRESALES column:', psCol.rows[0].n);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });

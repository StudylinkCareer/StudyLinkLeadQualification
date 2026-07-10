// scripts/diagPoolOwners.js — READ-ONLY. Who currently shows up as an owner in
// the Pool phase, and why. Pool is the fallback phase: phaseForPosition() sends
// Quality/Tech Support AND any unmapped/miscoded position here. This lists every
// distinct counselor on a Pool-phase order with their staff.position, so you can
// see which records to correct to shrink Pool to the intended few.
require('dotenv').config();
const { Pool } = require('pg');
const { POSITION_PHASE, phaseForPosition } = require('../src/utils/orderPhase');
const url = process.env.DATABASE_URL || '';
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

// The staff you want Pool restricted to.
const KEEP = new Set(['Mạch Nguyễn Phi Vân', 'Phạm Vũ Kim Chi', 'Rhod Joyce']);

(async () => {
  console.log('Host:', (url.match(/@([^:@/]+)/) || [])[1] || '(?)');
  console.log('Mapped positions →', JSON.stringify(POSITION_PHASE), '\n');

  // Distinct owners of Pool-phase orders (grouped like the Dashboard: by l.counselor),
  // joined to their current staff row.
  const r = await pool.query(
    `SELECT COALESCE(NULLIF(l.counselor,''),'(Unassigned)') AS owner,
            COUNT(*)::int AS pool_leads,
            st.position, st.role, st.is_active
       FROM leads l
       JOIN students s ON s.student_id = l.person_id
       LEFT JOIN staff st ON st.full_name = l.counselor AND COALESCE(st.staff_type,'')<>'event'
      WHERE s.order_phase = 'Pool'
      GROUP BY 1, st.position, st.role, st.is_active
      ORDER BY pool_leads DESC`,
    []
  );

  const keep = [], fix = [];
  let keepLeads = 0, fixLeads = 0;
  for (const row of r.rows) {
    const mapped = POSITION_PHASE[row.position];       // the phase this owner's position maps to (undefined if unmapped)
    const line = {
      owner: row.owner, pool_leads: row.pool_leads,
      position: row.position, role: row.role, active: row.is_active,
      // Why is this order in Pool?
      reason: row.owner === '(Unassigned)' ? 'no owner — real Pool holding'
            : mapped === 'Pool'            ? 'Quality/Tech — real Pool'
            : mapped                       ? `STALE: position maps to ${mapped}, but order_phase still Pool → needs re-sync`
            : row.position == null         ? 'position BLANK → fallback Pool'
            :                                `UNMAPPED position "${row.position}" → fallback Pool (fix the staff record)`,
    };
    if (KEEP.has(row.owner)) { keep.push(line); keepLeads += row.pool_leads; }
    else { fix.push(line); fixLeads += row.pool_leads; }
  }

  const pr = (rows) => rows.forEach(x => console.log(
    '  ' + String(x.pool_leads).padStart(5) + '  ' +
    (x.owner).padEnd(26) + '  pos=' + String(x.position).padEnd(18) +
    ' role=' + String(x.role).padEnd(12) + ' active=' + String(x.active).padEnd(6) + '  ' + x.reason));

  console.log(`✅ KEEP (your preferred Pool staff) — ${keep.length} owners, ${keepLeads} leads`);
  pr(keep);
  console.log(`\n⚠️  OUTSIDE the preferred list — ${fix.length} owners, ${fixLeads} leads (records to adjust)`);
  pr(fix);

  console.log(`\nSUMMARY: Pool currently has ${keep.length + fix.length} distinct owners across ${keepLeads + fixLeads} leads.`);
  console.log(`Restricting to your 3 removes ${fix.length} owners / ${fixLeads} leads from Pool.`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });

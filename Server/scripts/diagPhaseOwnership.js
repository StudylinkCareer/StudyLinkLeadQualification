// scripts/diagPhaseOwnership.js  — READ-ONLY diagnostic (no writes).
// Checks whether Counselling/Presales-phase orders are backed by an ACTIVE lead
// or are "closed-only" (all leads terminal) — i.e. whether reinstate's fallback
// over-assigned dormant orders. Safe to run against PROD.
require('dotenv').config();
const { Pool } = require('pg');
const url = process.env.DATABASE_URL || '';
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
const TERMINAL = "('Contracted','Lost','Archived','Cancelled')";

(async () => {
  console.log('Host:', (url.match(/@([^:@/]+)/) || [])[1] || '(?)');
  const q = `
    SELECT s.order_phase AS phase,
           COUNT(*)::int AS orders,
           COUNT(*) FILTER (WHERE act.n > 0)::int AS with_active_lead,
           COUNT(*) FILTER (WHERE act.n = 0)::int AS closed_only
      FROM students s
      JOIN LATERAL (
        SELECT COUNT(*)::int AS n FROM leads l
         WHERE l.person_id = s.student_id
           AND l.lead_status NOT IN ${TERMINAL}
      ) act ON true
     WHERE s.order_phase IN ('Counselling','Presales')
     GROUP BY s.order_phase ORDER BY s.order_phase`;
  const r = await pool.query(q);
  console.log('\nphase        orders  with_active_lead  closed_only(<-questionable)');
  r.rows.forEach(x => console.log(
    '  ' + x.phase.padEnd(12) + String(x.orders).padStart(6) +
    String(x.with_active_lead).padStart(18) + String(x.closed_only).padStart(13)));
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

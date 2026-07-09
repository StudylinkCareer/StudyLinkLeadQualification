// Read-only diagnostic: why aren't reassigned Orders showing for the counsellor?
// Prints, per Order: owner, owner's position, the phase that SHOULD derive from
// it, and the STORED order_phase — plus each lead's counsellor, and the relevant
// staff positions. No writes.
//   node scripts/diagOrderPhase.js
require('dotenv').config();
const { Pool } = require('pg');
const { phaseForPosition } = require('../src/utils/orderPhase');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

(async () => {
  const ids = ['20260701-06', '20260701-24'];
  const orders = await pool.query(
    `SELECT s.student_id, s.counselor AS order_owner, s.order_phase,
            os.position AS owner_position
       FROM students s
       LEFT JOIN staff os ON os.full_name = s.counselor
      WHERE s.student_id = ANY($1) ORDER BY s.student_id`, [ids]);

  for (const o of orders.rows) {
    const derived = phaseForPosition(o.owner_position);
    const flag = derived === o.order_phase ? '' : '   <-- STORED ≠ DERIVED';
    console.log(`\nORDER ${o.student_id}: owner="${o.order_owner}" ownerPosition="${o.owner_position}"`);
    console.log(`   derivedPhase=${derived} | STORED order_phase=${o.order_phase}${flag}`);
    const leads = await pool.query(
      `SELECT lead_id, counselor, lead_status FROM leads WHERE person_id=$1 ORDER BY lead_id`, [o.student_id]);
    for (const l of leads.rows) console.log(`   lead ${l.lead_id}: counselor="${l.counselor}" status=${l.lead_status}`);
  }

  const staff = await pool.query(
    `SELECT full_name, position, role, is_active FROM staff
      WHERE position IN ('Counselor','Senior Counselor','Quality','Tech Support')
         OR full_name ILIKE '%test%' ORDER BY position, full_name`);
  console.log('\nRelevant staff (name | position | role | active):');
  for (const s of staff.rows) console.log(`  "${s.full_name}" | ${s.position} | ${s.role} | ${s.is_active}`);

  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

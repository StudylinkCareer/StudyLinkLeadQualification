// Server/src/utils/orderPhase.js
// ---------------------------------------------------------------------------
// Sales Order PHASE / DEPARTMENT layer.
//
// An Order's phase is the department it currently sits in, read from the
// POSITION of its current owner (students.counselor -> staff.position). The
// phase governs reporting visibility: a counsellor sees only the leads of
// Orders in the Counselling phase (see permissionService / reporting).
//
// BUILD SCOPE (2026-07): only 'Counselling' and 'Pool' are developed. The
// other phases exist as reserved values so the model is complete, but their
// workflows/reporting are not built yet.
// ---------------------------------------------------------------------------

// staff.position  ->  Order phase (department).
// PreSales is a PARALLEL phase (can co-exist with Counselling); it maps here
// for completeness but is derived from the separate presales owner, not the
// primary counselor, so it does not drive the primary phase in scope now.
const POSITION_PHASE = {
  'Counselor':            'Counselling',
  'Senior Counselor':     'Counselling',
  'PreSales':             'Presales',
  'Quality':              'Pool',
  'Tech Support':         'Pool',
  'Case Officer, Direct': 'Case Officers',
  'Case Officer, Sub':    'Case Officers',
  'Customer Service':     'Support',
  'Marketing Staff':      'Marketing',
  'Marketing Manager':    'Marketing',
};

// Every valid phase value (used for validation / reserved-value docs).
const PHASES = ['Marketing', 'Counselling', 'Pool', 'Case Officers', 'Support', 'Presales'];

// The phase for a given owner position. An Order with no owner (or an owner
// whose position isn't a recognised phase) sits in the Pool holding state.
function phaseForPosition(position) {
  if (!position) return 'Pool';
  return POSITION_PHASE[position] || 'Pool';
}

// Recompute + persist one Order's phase from its current owner's position.
// Call this from every path that changes an Order's owner (assignStaff,
// distribution assign/release/recall, upload). `db` is a pg client or pool.
async function syncOrderPhase(db, studentId) {
  const r = await db.query(
    `SELECT st.position AS position
       FROM students s
       LEFT JOIN staff st ON st.full_name = s.counselor
      WHERE s.student_id = $1`,
    [studentId]
  );
  const position = r.rows.length ? r.rows[0].position : null;
  const phase = phaseForPosition(position);
  await db.query(
    `UPDATE students SET order_phase = $1, updated_at = NOW() WHERE student_id = $2`,
    [phase, studentId]
  );
  return phase;
}

module.exports = { POSITION_PHASE, PHASES, phaseForPosition, syncOrderPhase };

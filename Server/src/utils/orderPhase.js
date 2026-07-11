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

  // ── Authorisation-profile positions (2026-07-10) ──────────────────────────
  // After the profile migration, staff.position holds the PROFILE name, so the
  // phase map must resolve those too (order_phase derives from the owner's
  // position). Legacy values above are kept for un-migrated data.
  'CEO':                          'Pool',
  'COO':                          'Pool',
  'Manager, Marketing':           'Marketing',
  'Manager, Products':            'Pool',
  'Manager, Business Development': 'Business Development',
  'Manager, HR':                  'Pool',
  'Manager, Finance':             'Pool',
  'Manager, Technical Support':   'Pool',
  'Administrator, Office':        'Pool',
  'Staff, Marketing':             'Marketing',
  'Staff, Business Development':   'Business Development',
  'Staff, Finance':               'Pool',
  'Staff, HR':                    'Pool',
  'Lead, Counsellor':             'Counselling',
  'Staff, Counsellor':            'Counselling',
  'Lead, Pre-sales':              'Presales',
  'Staff, Pre-sales':             'Presales',
  'Lead, Case Officer':           'Case Officers',
  'Staff, Case Officer - Dir':    'Case Officers',
  'Staff, Case Officer - Sub':    'Case Officers',
  'Staff, Data Quality':          'Pool',
  'Staff, Technical Support':     'Pool',
};

// Every valid phase value (used for validation / reserved-value docs).
const PHASES = ['Marketing', 'Counselling', 'Pool', 'Case Officers', 'Support', 'Presales', 'Business Development'];

// ---------------------------------------------------------------------------
// CANONICAL PHASE MODEL (2026-07-11) — single source of truth for the phase
// mover (individual + mass). Code-driven so it no longer depends on the messy
// phase_transitions / phase_positions tables or their "Case Officer - Dir/Sub"
// naming. KEEP IN SYNC with LeadManagement PHASE_MODEL (Leads.jsx/LeadDetail.jsx).
//
// PHASE_SLOTS: the staff position slot(s) a phase can be assigned to. A move
// picks the phase, then ONE of these positions, then the staff member. Single-slot
// phases auto-pick. (Senior Counselor removed — replaced by Lead/Staff Counsellor.)
const PHASE_SLOTS = {
  'Marketing':            ['Marketing Staff'],
  'Counselling':          ['Counselor'],
  'Presales':             ['PreSales'],
  'Pool':                 ['Quality', 'Tech Support'],
  'Business Development':  ['Business Development'],
  'Case Officers':        ['Case Officer, Direct', 'Case Officer, Sub'],
};

// Allowed phase moves (from -> [to]). Pool is the hub. Easily edited.
const PHASE_TRANSITIONS = {
  'Marketing':            ['Counselling', 'Presales', 'Pool'],
  'Presales':             ['Counselling', 'Pool'],
  'Counselling':          ['Presales', 'Pool', 'Case Officers'],
  'Pool':                 ['Marketing', 'Presales', 'Counselling', 'Business Development', 'Case Officers'],
  'Business Development':  ['Counselling', 'Presales', 'Pool'],
  'Case Officers':        ['Pool', 'Counselling'],
};

// Phases where a recipient is MANDATORY on a move (front-line ownership).
const RECIPIENT_REQUIRED = new Set(['Counselling', 'Presales', 'Case Officers']);

function slotsForPhase(phase)            { return PHASE_SLOTS[phase] || []; }
function allowedTransitions(fromPhase)   { return PHASE_TRANSITIONS[fromPhase] || []; }
function isTransitionAllowed(from, to)   { return from === to || allowedTransitions(from).includes(to); }
function recipientRequired(phase)        { return RECIPIENT_REQUIRED.has(phase); }

// ---------------------------------------------------------------------------
// Reporting: which lead STATUSES each department phase reports against.
// This is the ONLY axis that differs between departments — the phase gate
// (order_phase === phase) already decides WHICH orders belong to a department.
// Rules (2026-07-10, user):
//   • Counselling → ACTIVE book only (closed leads drop off the report).
//   • Pre-Sales   → EVERY status (they still follow up Lost/Archived/Cancelled).
//   • Pool        → EVERY status (Quality/Admin oversight).
// A `null` set (Presales/Pool + any not-yet-built phase) = no status filter.
// KEEP IN SYNC with LeadManagement/src/pages/Dashboard.jsx
//   → REPORTABLE_STATUSES_BY_PHASE / attributableTo().
const ACTIVE_STATUSES = [
  'New', 'Engaged', 'Contracted', 'Proposal',
  'Met with customer and family', 'Vetted', 'Family negotiation/review',
  'Nurturing', 'Not contactable', 'Renewed',
];
// Connected-unit model (2026-07-11): reports show ACTIVE leads only, UNIFORMLY
// across every front-line phase. Terminal statuses (Lost/Archived/Cancelled) are
// frozen history and drop out of every front-line report. Pool is deliberately
// NOT a lead-status report — it's a record-level (Sales-doc) queue handled in the
// UI, so its entry here stays `null` (no lead-status gate) pending the P4 rework.
const REPORTABLE_STATUSES_BY_PHASE = {
  Counselling:            ACTIVE_STATUSES,
  Presales:               ACTIVE_STATUSES,
  Marketing:              ACTIVE_STATUSES,
  'Business Development': ACTIVE_STATUSES,
  'Case Officers':        ACTIVE_STATUSES,
  Pool:                   null,   // record-level view (P4) — no lead-status gate
};

// True if `status` is reported for `phase`. Blank/null normalises to 'New'
// (the app shows blank as New everywhere).
function isReportableStatus(phase, status) {
  const set = REPORTABLE_STATUSES_BY_PHASE[phase];
  if (!set) return true;                 // phase reports all statuses
  return set.includes(status || 'New');
}

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
  // Resolve the owner's position by name, but EXCLUDE synthetic event-rep rows
  // (staff_type='event') — a person can have a duplicate 'Event staff' row, and
  // matching that would wrongly resolve the phase to Pool. Prefer the active,
  // real record; LIMIT 1 keeps it deterministic.
  const r = await db.query(
    `SELECT st.position AS position
       FROM students s
       LEFT JOIN staff st
         ON st.full_name = s.counselor AND COALESCE(st.staff_type, '') <> 'event'
      WHERE s.student_id = $1
      ORDER BY st.is_active DESC NULLS LAST
      LIMIT 1`,
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

module.exports = {
  POSITION_PHASE, PHASES, phaseForPosition, syncOrderPhase,
  ACTIVE_STATUSES, REPORTABLE_STATUSES_BY_PHASE, isReportableStatus,
  PHASE_SLOTS, PHASE_TRANSITIONS, slotsForPhase, allowedTransitions, isTransitionAllowed, recipientRequired,
};

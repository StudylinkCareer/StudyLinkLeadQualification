// Server/src/models/OrderAssignment.js
// ---------------------------------------------------------------------------
// Data access for the phase-driven assignment model:
//   • order_assignments  — one owner per Order × staff position
//   • phase_transitions  — allowed phase moves (state machine)
//   • phase_positions    — which positions are EDITABLE in each phase
// All reads/writes accept an optional pg client so callers can run them inside
// their own transaction.
// ---------------------------------------------------------------------------

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Legacy students/leads columns that mirror four of the positions. Assignments
// for these positions still cascade to the leads' columns so existing reporting
// keeps working; other positions live only in order_assignments (for now).
const POSITION_COLUMN = {
  'Counselor':        'counselor',
  'Senior Counselor': 'senior_counselor',
  'PreSales':         'presales',
  'Marketing Staff':  'marketing_staff',
};

// ── order_assignments ──────────────────────────────────────────────────────

// All of an Order's assignments as { position: staffName }.
async function getForOrder(studentId, db = pool) {
  const r = await db.query(
    `SELECT position, staff_name FROM order_assignments WHERE student_id = $1`,
    [studentId]);
  const out = {};
  for (const row of r.rows) out[row.position] = row.staff_name || '';
  return out;
}

// Upsert one position's owner ('' / null clears it).
async function setForOrder(db, studentId, position, staffName) {
  const name = (staffName && String(staffName).trim()) || null;
  await db.query(
    `INSERT INTO order_assignments (student_id, position, staff_name, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (student_id, position)
       DO UPDATE SET staff_name = EXCLUDED.staff_name, updated_at = now()`,
    [studentId, position, name]);
}

// ── phase rules (control tables) ───────────────────────────────────────────

// Phases an Order in `fromPhase` may move to (is_allowed = true).
async function allowedTransitions(fromPhase, db = pool) {
  if (!fromPhase) return [];
  const r = await db.query(
    `SELECT to_phase FROM phase_transitions
      WHERE from_phase = $1 AND is_allowed = true ORDER BY to_phase`,
    [fromPhase]);
  return r.rows.map(x => x.to_phase);
}

async function isTransitionAllowed(fromPhase, toPhase, db = pool) {
  if (fromPhase === toPhase) return true;
  const r = await db.query(
    `SELECT 1 FROM phase_transitions
      WHERE from_phase = $1 AND to_phase = $2 AND is_allowed = true LIMIT 1`,
    [fromPhase, toPhase]);
  return r.rowCount > 0;
}

// Positions editable in a phase (is_active = true).
async function activePositions(phase, db = pool) {
  if (!phase) return [];
  const r = await db.query(
    `SELECT position FROM phase_positions
      WHERE phase = $1 AND is_active = true ORDER BY position`,
    [phase]);
  return r.rows.map(x => x.position);
}

// Record a blocked batch transfer (upload / redistribution) for post-processing.
async function logTransferException(db, e) {
  await db.query(
    `INSERT INTO phase_transfer_exceptions
       (student_id, lead_id, from_phase, to_phase, attempted_owner, source, reason, batch_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.studentId, e.leadId || null, e.fromPhase || null, e.toPhase || null,
     e.owner || null, e.source || null, e.reason || null, e.batchId || null]);
}

// Unresolved (default) transfer exceptions, most recent first — powers the report.
async function listTransferExceptions({ resolved = false } = {}, db = pool) {
  const r = await db.query(
    `SELECT * FROM phase_transfer_exceptions WHERE resolved = $1 ORDER BY created_at DESC LIMIT 500`,
    [resolved]);
  return r.rows;
}

module.exports = {
  pool, POSITION_COLUMN,
  getForOrder, setForOrder,
  allowedTransitions, isTransitionAllowed, activePositions,
  logTransferException, listTransferExceptions,
};

// Server/src/services/eventBudgetApproval.js
// ─────────────────────────────────────────────────────────────────────
// Mom's budget-approval workflow (Event Report -> Budget). The first
// per-INDIVIDUAL-account (not per-role) authorization gate in the codebase
// — every existing check in authProfiles.js is a role/position string, but
// this one has to identify one specific person regardless of title, so it's
// a dedicated email compared against req.session.staffEmail.
//
// No lock semantics: approving is a point-in-time sign-off (stamp + email),
// not a freeze. Re-clicking Duyệt just re-stamps and re-sends.
// ─────────────────────────────────────────────────────────────────────
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const BUDGET_TYPES = new Set(['planned', 'actual']);

// Read at call time (not module load) so a Railway env var change takes
// effect on the next request with no redeploy — same idiom as
// resendService.cfg(). The frontend never sees this email: routes only ever
// expose the boolean result via getBudget's `canApprove` field.
function isApprover(email) {
  const approver = (process.env.BUDGET_APPROVER_EMAIL || '').trim().toLowerCase();
  const candidate = (email || '').trim().toLowerCase();
  return Boolean(approver) && candidate === approver;
}

// Writes the same note to up to 2 underlying event_budget_items rows (the
// merged row's planned + actual item ids) — mirrors how the frontend's
// MergedBudgetItemForm already reconciles up to 2 items per merged save, so
// a comment on a merged line applies regardless of which side(s) exist.
async function saveApprovalNote(eventId, itemIds, note, staffName) {
  const ids = (itemIds || []).filter((n) => Number.isInteger(n));
  if (!ids.length) throw new Error('itemIds is required');
  const r = await pool.query(
    `UPDATE event_budget_items
        SET approval_note = $3, approval_note_by = $4, approval_note_at = NOW()
      WHERE event_id = $1 AND id = ANY($2::int[])
      RETURNING id, approval_note, approval_note_by, approval_note_at`,
    [eventId, ids, note || null, staffName || null]
  );
  return r.rows.map((row) => ({
    id: row.id, approvalNote: row.approval_note,
    approvalNoteBy: row.approval_note_by, approvalNoteAt: row.approval_note_at,
  }));
}

// Stamps events.budget_{type}_approved_(at/by), then gathers everything
// budgetPdf.buildBudgetApprovalPdf needs for that budget_type's items.
async function approveBudget(eventId, budgetType, staffName) {
  if (!BUDGET_TYPES.has(budgetType)) throw new Error('budgetType must be planned or actual');
  // col is one of exactly two hardcoded strings (never user input) — safe
  // to interpolate into the column list.
  const col = budgetType === 'planned' ? 'budget_planned_approved' : 'budget_actual_approved';

  const evRes = await pool.query(
    `UPDATE events SET ${col}_at = NOW(), ${col}_by = $2
      WHERE id = $1
      RETURNING id, name, start_date, ${col}_at AS approved_at, ${col}_by AS approved_by`,
    [eventId, staffName || null]
  );
  if (!evRes.rowCount) throw new Error('Event not found');
  const event = evRes.rows[0];

  const itemsRes = await pool.query(
    `SELECT category, line_item, unit, unit_price, quantity, amount, note,
            approval_note, approval_note_by
       FROM event_budget_items
      WHERE event_id = $1 AND budget_type = $2
      ORDER BY category, id`,
    [eventId, budgetType]
  );
  const total = itemsRes.rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  return {
    event: { id: event.id, name: event.name, startDate: event.start_date },
    budgetType,
    approvedAt: event.approved_at,
    approvedBy: event.approved_by,
    total,
    items: itemsRes.rows.map((r) => ({
      category: r.category, lineItem: r.line_item, unit: r.unit,
      unitPrice: r.unit_price != null ? Number(r.unit_price) : null,
      quantity: r.quantity != null ? Number(r.quantity) : null,
      amount: Number(r.amount), note: r.note,
      approvalNote: r.approval_note, approvalNoteBy: r.approval_note_by,
    })),
  };
}

module.exports = { isApprover, saveApprovalNote, approveBudget, BUDGET_TYPES };

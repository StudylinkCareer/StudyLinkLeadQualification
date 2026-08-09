// Server/src/services/uncontactableTransfer.js
// ─────────────────────────────────────────────────────────────────────
// Uncontactable → Pre-sales auto-transfer (confirmed 2026-08). See the
// migration file (addUncontactableTransfer.js) for the schema and full
// rationale. Called from noteController.addLeadNote right after a note
// saves — "as soon as" the 3rd qualifying KBM note lands, per the
// original request.
//
// Condition: the lead is currently 'Not contactable', owned by a
// counselor, and that counselor has logged KBM (unanswered) calls to
// THIS lead covering all 3 distinct khung giờ time-slots (see
// callSlots.js) — at least one call in each of slot 1, 2, and 3.
//
// Effect (scoped to the lead's own row only — see the migration's header
// comment for why students.order_phase is deliberately NOT touched):
//   - leads.counselor  -> '' (cleared)
//   - leads.presales   -> the round-robin pick
//   - leads.lead_status -> 'New'
// Logged to uncontactable_transfers, which also drives the round-robin
// (whoever has received the fewest transfers so far gets the next one —
// self-balancing even as the roster changes, no fragile pointer to keep
// in sync).
// ─────────────────────────────────────────────────────────────────────
const { Pool } = require('pg');
const { isCallNote, classifyKbm } = require('./callClassification');
const { slotOf } = require('./callSlots');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Whoever in the roster has the fewest uncontactable_transfers so far gets
// picked next — ties broken by roster (sort_order) position. Self-balancing:
// adding/removing someone from the roster never desyncs a pointer, it just
// changes who's "behind" in the count.
async function pickNextPresales() {
  const r = await pool.query(`
    SELECT t.staff_id, s.full_name,
           (SELECT COUNT(*) FROM uncontactable_transfers WHERE to_presales_staff_id = t.staff_id) AS received
      FROM uncontactable_transfer_presales_staff t
      JOIN staff s ON s.id = t.staff_id
     WHERE s.is_active = true
     ORDER BY received ASC, t.sort_order ASC
     LIMIT 1
  `);
  return r.rows[0] || null;   // { staff_id, full_name, received }
}

// Does `notes` (already isCallNote+KBM-filtered) cover all 3 distinct slots?
function coversAllSlots(kbmNotes) {
  const slots = new Set(kbmNotes.map((n) => slotOf(n.created_at)));
  return slots.has(1) && slots.has(2) && slots.has(3);
}

/**
 * Checks one lead after a note was just saved for it, and performs the
 * transfer if it now qualifies. Safe to call unconditionally — it's a
 * no-op (returns null) whenever the lead isn't 'Not contactable', has no
 * counselor, or doesn't yet have KBM calls across all 3 slots.
 *
 * Never throws — a failure here must never break the note-save request
 * that triggered it. Returns { transferred: true, ... } | { transferred: false, reason } .
 */
async function checkAndTransfer(leadId) {
  try {
    const leadRes = await pool.query(
      `SELECT lead_id, person_id AS student_id, counselor, lead_status FROM leads WHERE lead_id = $1`,
      [leadId]
    );
    const lead = leadRes.rows[0];
    if (!lead) return { transferred: false, reason: 'lead_not_found' };
    if (lead.lead_status !== 'Not contactable') return { transferred: false, reason: 'not_uncontactable' };
    const counselor = (lead.counselor || '').trim();
    if (!counselor) return { transferred: false, reason: 'no_counselor' };

    const noteRes = await pool.query(
      `SELECT id, content, contact_platform, call_answered, created_at
         FROM student_notes WHERE lead_id = $1 AND author_name = $2`,
      [leadId, counselor]
    );
    const kbmNotes = noteRes.rows.filter((n) => isCallNote(n) && classifyKbm(n));
    if (!coversAllSlots(kbmNotes)) return { transferred: false, reason: 'not_enough_slots' };

    const nextPresales = await pickNextPresales();
    if (!nextPresales) return { transferred: false, reason: 'no_presales_roster' };

    // Guarded by lead_status in the WHERE clause: if two notes race each
    // other into this function concurrently, only the first UPDATE actually
    // changes anything (the second sees lead_status already flipped to
    // 'New' and affects 0 rows) — prevents a double-transfer.
    const updateRes = await pool.query(
      `UPDATE leads SET counselor = '', presales = $2, lead_status = 'New', updated_at = NOW()
        WHERE lead_id = $1 AND lead_status = 'Not contactable'
        RETURNING lead_id`,
      [leadId, nextPresales.full_name]
    );
    if (updateRes.rowCount === 0) return { transferred: false, reason: 'already_transferred' };

    // One qualifying note id per slot (earliest in each), for the audit trail.
    const bySlot = new Map();
    for (const n of kbmNotes) {
      const s = slotOf(n.created_at);
      if (!bySlot.has(s)) bySlot.set(s, n.id);
    }
    await pool.query(
      `INSERT INTO uncontactable_transfers
         (lead_id, student_id, from_counselor, to_presales_staff_id, to_presales_name, qualifying_note_ids)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [leadId, lead.student_id, counselor, nextPresales.staff_id, nextPresales.full_name, [...bySlot.values()]]
    );

    return { transferred: true, leadId, studentId: lead.student_id, from: counselor, to: nextPresales.full_name };
  } catch (err) {
    console.error('[uncontactableTransfer] check failed for lead', leadId, err.message);
    return { transferred: false, reason: 'error', error: err.message };
  }
}

module.exports = { checkAndTransfer, pickNextPresales, coversAllSlots };

// Server/src/services/uncontactableTransfer.js
// ─────────────────────────────────────────────────────────────────────
// Uncontactable auto-transfer chain (confirmed 2026-08). See
// addUncontactableTransfer.js and addPresalesEscalation.js for schema +
// full rationale. Three hops, called right after a note saves — "as soon
// as" the 3rd qualifying KBM note lands, per the original request:
//
//   1. Sales/Counselor -> Presales #1     (checkAndTransfer, unchanged)
//   2. Presales #1     -> Presales #2     (checkAndTransferPresales)
//   3. Presales #2     -> Pool (Phi Vân)  (checkAndTransferPresales)
//
// Each hop's qualification: the current owner has logged KBM (unanswered)
// calls to THIS lead covering all 3 of THEIR OWN distinct "khung giờ" —
// see callSlots.js. Two staffing patterns exist among Pre-sales, tracked
// per-roster-member as slot_mode:
//   'standard'    — the fixed 3-slot business-hours system (callSlots.slotOf)
//   'evening_gap' — 3 evening calls each >=60min apart (callSlots.
//                   hasThreeGappedEveningCalls) — telesales-only staff
//
// Which hop a lead is on is read straight from uncontactable_transfers
// history (count of sales_to_presales + presales_to_presales rows for
// this lead) rather than a separate counter — 0 or 1 = currently on
// Presales #1 (next hop is presales_to_presales), 2+ = currently on
// Presales #2 (next hop is presales_to_pool).
//
// Round-robin (pickNextPresales) is weighted by working hours (confirmed
// 2026-08): whoever is furthest behind their fair share — received ÷
// this month's capacity (hours/day × days/month, presales_working_hours)
// — gets the next one, not just "fewest received". Falls back to plain
// fewest-received if nobody has hours configured for the current month
// yet, so the system still works before that table is filled in. Same
// weighting applies to BOTH the original Sales->Presales hop and the new
// Presales-internal hops — one shared roster, one shared fairness rule.
//
// The final hop does NOT add Phi Vân to the Presales round-robin — she's
// Data Quality, not Presales. Escalating to her reuses the EXISTING "no
// owner -> Pool" convention (studentController.createStudent's else
// branch): students.order_phase = 'Pool' + an order_assignments row for
// position 'Quality' -> her name. That's the same mechanism that already
// puts any order with no counselor into "her pool" today.
//
// Every hop also syncs the Student/Sales-level record (order_phase,
// counselor, presales, order_assignments) — confirmed 2026-08. Previously
// only the LEAD row was updated, so the Sales page kept showing
// "Counselling" + the old counselor's name until someone noticed and
// fixed it by hand; see syncStudentForPresalesHandoff below.
// ─────────────────────────────────────────────────────────────────────
const { Pool } = require('pg');
const { isCallNote, classifyKbm } = require('./callClassification');
const { slotOf, hasThreeGappedEveningCalls } = require('./callSlots');
const OrderAssignment = require('../models/OrderAssignment');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const POOL_OWNER_NAME = 'Mạch Nguyễn Phi Vân';

// VN-local first-of-month, as a 'YYYY-MM-01' date string — the
// presales_working_hours lookup key. Pure UTC arithmetic (no mixing
// new Date(ymd) with local getters — see this session's timezone notes).
function vnMonthKey(now = new Date()) {
  const VN_MS = 7 * 60 * 60 * 1000;
  const vn = new Date(now.getTime() + VN_MS);
  const y = vn.getUTCFullYear();
  const m = String(vn.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

// Whoever in the roster is furthest behind their fair share gets picked
// next — received transfers (any hop, this table only) ÷ this month's
// capacity. Ties broken by roster (sort_order) position, which the SQL
// ORDER BY already applies and JS's stable sort preserves. Excludes
// `excludeStaffId` (the lead's current owner) so a hop can never bounce
// back to the same person. Falls back to plain "fewest received" if no
// one in the (remaining) roster has any hours configured this month.
//
// Capacity (2026-08 Phase-0 redesign, planned with Hong Ha): presales_working_hours
// is now per-weekday (staff_id, month, day_of_week) -> hours, not a flat
// hours_per_day x days_per_month average — so capacity for "this month" is
// the sum of each configured weekday's hours x how many of that weekday
// actually fall in the current VN month. "Copy forward" semantics: a month
// with no rows of its own falls back to the most recent earlier month that
// has any, same as the Daily Call Quotas grid.
async function pickNextPresales(excludeStaffId = null) {
  const monthKey = vnMonthKey();
  const hourRows = (await pool.query(
    `SELECT staff_id, to_char(month,'YYYY-MM-01') AS month, day_of_week, hours
       FROM presales_working_hours`
  )).rows;
  const byStaff = new Map(); // staffId -> Map(month -> [7] hours)
  for (const h of hourRows) {
    if (!byStaff.has(h.staff_id)) byStaff.set(h.staff_id, new Map());
    const byMonth = byStaff.get(h.staff_id);
    if (!byMonth.has(h.month)) byMonth.set(h.month, [0,0,0,0,0,0,0]);
    byMonth.get(h.month)[h.day_of_week] = Number(h.hours);
  }
  // How many of each weekday (0=Mon..6=Sun) fall in the current VN month.
  const VN_MS = 7 * 60 * 60 * 1000;
  const now = new Date(Date.now() + VN_MS);
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const dowCounts = [0,0,0,0,0,0,0];
  for (let d = 1; d <= daysInMonth; d++) {
    const jsDay = new Date(Date.UTC(y, m, d)).getUTCDay(); // 0=Sun..6=Sat
    dowCounts[(jsDay + 6) % 7]++; // -> 0=Mon..6=Sun
  }
  function capacityFor(staffId) {
    const byMonth = byStaff.get(staffId);
    if (!byMonth || byMonth.size === 0) return 0;
    const months = [...byMonth.keys()].sort();
    let best = null;
    for (const mo of months) { if (mo <= monthKey) best = mo; else break; }
    const perDow = best ? byMonth.get(best) : [0,0,0,0,0,0,0];
    return perDow.reduce((sum, hrs, dow) => sum + hrs * dowCounts[dow], 0);
  }

  const r = await pool.query(
    `SELECT t.staff_id, s.full_name, t.slot_mode,
            (SELECT COUNT(*) FROM uncontactable_transfers WHERE to_presales_staff_id = t.staff_id) AS received
       FROM uncontactable_transfer_presales_staff t
       JOIN staff s ON s.id = t.staff_id
      WHERE s.is_active = true
        AND ($1::int IS NULL OR t.staff_id <> $1)
      ORDER BY t.sort_order ASC`,
    [excludeStaffId]
  );
  const candidates = r.rows.map((row) => ({
    staffId: row.staff_id, fullName: row.full_name, slotMode: row.slot_mode,
    capacity: capacityFor(row.staff_id), received: Number(row.received),
  }));
  if (candidates.length === 0) return null;

  const withCapacity = candidates.filter((c) => c.capacity > 0);
  const usingCapacity = withCapacity.length > 0;
  const scored = usingCapacity ? withCapacity : candidates;

  let best = scored[0];
  for (const c of scored.slice(1)) {
    const score = usingCapacity ? c.received / c.capacity : c.received;
    const bestScore = usingCapacity ? best.received / best.capacity : best.received;
    if (score < bestScore) best = c;
  }
  return { staff_id: best.staffId, full_name: best.fullName, slot_mode: best.slotMode, received: best.received };
}

// slot_mode for a Presales staffer by name — 'standard' if they're not on
// the roster at all (matches the column's own DB default, e.g. someone
// assigned by hand outside the round-robin).
async function getSlotMode(staffName) {
  const r = await pool.query(
    `SELECT t.slot_mode FROM uncontactable_transfer_presales_staff t
       JOIN staff s ON s.id = t.staff_id WHERE s.full_name = $1 LIMIT 1`,
    [staffName]
  );
  return r.rows[0]?.slot_mode || 'standard';
}

// Does `kbmNotes` (already isCallNote+KBM-filtered) qualify as "3 distinct
// khung giờ" under the given slot_mode?
function qualifiesForSlotMode(kbmNotes, slotMode) {
  if (slotMode === 'evening_gap') {
    return hasThreeGappedEveningCalls(kbmNotes.map((n) => n.created_at));
  }
  const slots = new Set(kbmNotes.map((n) => slotOf(n.created_at)));
  return slots.has(1) && slots.has(2) && slots.has(3);
}
// Kept for the standard-mode case specifically (used directly by the
// Sales->Presales hop below, which is always 'standard' — counselors
// aren't on the evening-telesales schedule).
function coversAllSlots(kbmNotes) {
  return qualifiesForSlotMode(kbmNotes, 'standard');
}

// Keeps the Student/Sales-level record in step with an automated hand-off
// (confirmed 2026-08). Previously only the LEAD row was updated, so the
// Sales page kept showing "Counselling" + the old counselor's name until
// someone noticed and fixed it by hand via the phase mover — this
// automates exactly that manual fix, using the same underlying writes
// changePhase/setAssignment already use (order_phase, OrderAssignment,
// and the mirrored students column) so it behaves identically to a human
// doing it.
//
// Guarded: only applies when this lead is the student's SOLE active
// (non-terminal) lead. A student with a second active lead under a
// different counselor is a case this feature was never designed to
// arbitrate (checked 2026-08: currently 0 students have this) — rather
// than guess, it's logged to phase_transfer_exceptions for manual review,
// the same table mass-assign/upload already use for this purpose.
async function syncStudentForPresalesHandoff(client, studentId, leadId, presalesName) {
  const active = await client.query(
    `SELECT lead_id, counselor FROM leads
      WHERE person_id = $1 AND lead_status NOT IN ('Contracted', 'Lost', 'Archived', 'Cancelled')`,
    [studentId]
  );
  const conflicting = active.rows.find((r) => r.lead_id !== leadId && (r.counselor || '').trim());
  if (conflicting) {
    await OrderAssignment.logTransferException(client, {
      studentId, leadId, fromPhase: 'Counselling', toPhase: 'Presales',
      owner: presalesName, source: 'uncontactable_transfer',
      reason: `Student has another active lead (#${conflicting.lead_id}) under a different counselor — student-level sync skipped`,
    });
    return { synced: false };
  }
  await client.query(
    `UPDATE students SET order_phase = 'Presales', counselor = '', presales = $1, updated_at = NOW() WHERE student_id = $2`,
    [presalesName, studentId]
  );
  await OrderAssignment.setForOrder(client, studentId, 'PreSales', presalesName);
  return { synced: true };
}

async function getOwnKbmNotes(leadId, authorName) {
  const r = await pool.query(
    `SELECT id, content, contact_platform, call_answered, created_at
       FROM student_notes WHERE lead_id = $1 AND author_name = $2`,
    [leadId, authorName]
  );
  return r.rows.filter((n) => isCallNote(n) && classifyKbm(n));
}

/**
 * Hop 1: Sales/Counselor -> Presales #1. Checks one lead after a note was
 * just saved for it, and performs the transfer if it now qualifies. Safe
 * to call unconditionally — a no-op (returns null-ish) whenever the lead
 * isn't 'Not contactable', has no counselor, or doesn't yet have KBM calls
 * across all 3 slots.
 *
 * Never throws — a failure here must never break the note-save request
 * that triggered it. Returns { transferred: true, ... } | { transferred: false, reason }.
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

    const kbmNotes = await getOwnKbmNotes(leadId, counselor);
    if (!coversAllSlots(kbmNotes)) return { transferred: false, reason: 'not_enough_slots' };

    const nextPresales = await pickNextPresales();
    if (!nextPresales) return { transferred: false, reason: 'no_presales_roster' };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Guarded by lead_status in the WHERE clause: if two notes race each
      // other into this function concurrently, only the first UPDATE
      // actually changes anything (the second sees lead_status already
      // flipped to 'New' and affects 0 rows) — prevents a double-transfer.
      const updateRes = await client.query(
        `UPDATE leads SET counselor = '', presales = $2, lead_status = 'New', updated_at = NOW()
          WHERE lead_id = $1 AND lead_status = 'Not contactable'
          RETURNING lead_id`,
        [leadId, nextPresales.full_name]
      );
      if (updateRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { transferred: false, reason: 'already_transferred' };
      }
      await syncStudentForPresalesHandoff(client, lead.student_id, leadId, nextPresales.full_name);
      await logTransfer({
        db: client, leadId, studentId: lead.student_id, transferType: 'sales_to_presales',
        fromCounselor: counselor, toStaffId: nextPresales.staff_id, toName: nextPresales.full_name,
        kbmNotes,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    return { transferred: true, leadId, studentId: lead.student_id, from: counselor, to: nextPresales.full_name };
  } catch (err) {
    console.error('[uncontactableTransfer] check failed for lead', leadId, err.message);
    return { transferred: false, reason: 'error', error: err.message };
  }
}

/**
 * Hops 2 & 3: Presales #1 -> Presales #2 -> Pool (Phi Vân). Call after a
 * 'presales' note saves. Determines which hop the lead is currently on
 * from its own uncontactable_transfers history (0 or 1 prior hand-off =
 * on Presales #1, next hop is presales_to_presales; 2+ = on Presales #2,
 * next hop is presales_to_pool) — never throws.
 */
async function checkAndTransferPresales(leadId) {
  try {
    const leadRes = await pool.query(
      `SELECT lead_id, person_id AS student_id, presales, lead_status FROM leads WHERE lead_id = $1`,
      [leadId]
    );
    const lead = leadRes.rows[0];
    if (!lead) return { transferred: false, reason: 'lead_not_found' };
    if (lead.lead_status !== 'New') return { transferred: false, reason: 'not_new' };
    const presales = (lead.presales || '').trim();
    if (!presales) return { transferred: false, reason: 'no_presales' };

    const slotMode = await getSlotMode(presales);
    const kbmNotes = await getOwnKbmNotes(leadId, presales);
    if (!qualifiesForSlotMode(kbmNotes, slotMode)) return { transferred: false, reason: 'not_enough_slots' };

    const hopCountRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM uncontactable_transfers
        WHERE lead_id = $1 AND transfer_type IN ('sales_to_presales', 'presales_to_presales')`,
      [leadId]
    );
    const priorHops = hopCountRes.rows[0].c;
    const isSecondPresales = priorHops >= 2;

    const presalesStaffRes = await pool.query(`SELECT id FROM staff WHERE full_name = $1 LIMIT 1`, [presales]);
    const fromStaffId = presalesStaffRes.rows[0]?.id || null;

    if (!isSecondPresales) {
      // Hop 2: Presales #1 -> Presales #2. Exclude the current owner so it
      // can never bounce back to the same person.
      const next = await pickNextPresales(fromStaffId);
      if (!next) return { transferred: false, reason: 'no_presales_roster' };

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updateRes = await client.query(
          `UPDATE leads SET presales = $2, lead_status = 'New', updated_at = NOW()
            WHERE lead_id = $1 AND lead_status = 'New' AND presales = $3
            RETURNING lead_id`,
          [leadId, next.full_name, presales]
        );
        if (updateRes.rowCount === 0) {
          await client.query('ROLLBACK');
          return { transferred: false, reason: 'already_transferred' };
        }
        await syncStudentForPresalesHandoff(client, lead.student_id, leadId, next.full_name);
        await logTransfer({
          db: client, leadId, studentId: lead.student_id, transferType: 'presales_to_presales',
          fromPresalesStaffId: fromStaffId, fromPresalesName: presales,
          toStaffId: next.staff_id, toName: next.full_name, kbmNotes,
        });
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      return { transferred: true, hop: 'presales_to_presales', leadId, studentId: lead.student_id, from: presales, to: next.full_name };
    }

    // Hop 3: Presales #2 -> Pool (Phi Vân). Reuses the existing "no owner"
    // convention rather than a Presales-style assignment — she's Data
    // Quality, not on the round-robin roster. Resolved and validated
    // BEFORE opening the transaction so a missing/renamed account fails
    // loudly instead of moving the lead into Pool with a broken audit row.
    const vanRes = await pool.query(`SELECT id FROM staff WHERE full_name = $1 LIMIT 1`, [POOL_OWNER_NAME]);
    const vanId = vanRes.rows[0]?.id;
    if (!vanId) return { transferred: false, reason: 'pool_owner_not_found' };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updateRes = await client.query(
        `UPDATE leads SET presales = '', lead_status = 'New', updated_at = NOW()
          WHERE lead_id = $1 AND lead_status = 'New' AND presales = $2
          RETURNING lead_id`,
        [leadId, presales]
      );
      if (updateRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { transferred: false, reason: 'already_transferred' };
      }
      await client.query(`UPDATE students SET order_phase = 'Pool', updated_at = NOW() WHERE student_id = $1`, [lead.student_id]);
      await OrderAssignment.setForOrder(client, lead.student_id, 'Quality', POOL_OWNER_NAME);
      // Audit row written in the SAME transaction — a lead must never end
      // up transferred with no trail of it (or vice versa).
      await logTransfer({
        db: client, leadId, studentId: lead.student_id, transferType: 'presales_to_pool',
        fromPresalesStaffId: fromStaffId, fromPresalesName: presales,
        toStaffId: vanId, toName: POOL_OWNER_NAME, kbmNotes,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    return { transferred: true, hop: 'presales_to_pool', leadId, studentId: lead.student_id, from: presales, to: POOL_OWNER_NAME };
  } catch (err) {
    console.error('[uncontactableTransfer] presales check failed for lead', leadId, err.message);
    return { transferred: false, reason: 'error', error: err.message };
  }
}

// One qualifying note id per slot (or, for evening_gap, just every KBM
// note — there's no fixed 3-bucket to dedupe against) — audit trail only.
// Pass `db` (a client already inside a transaction) when the log write
// must be atomic with the state change it's recording; defaults to the
// pool for the non-transactional hops (matches the original hop 1's
// existing, already-shipped non-atomic pattern).
async function logTransfer({ db = pool, leadId, studentId, transferType, fromCounselor, fromPresalesStaffId, fromPresalesName, toStaffId, toName, kbmNotes }) {
  const qualifyingIds = [...new Set(kbmNotes.map((n) => n.id))];
  await db.query(
    `INSERT INTO uncontactable_transfers
       (lead_id, student_id, from_counselor, from_presales_staff_id, from_presales_name,
        to_presales_staff_id, to_presales_name, qualifying_note_ids, transfer_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [leadId, studentId, fromCounselor || null, fromPresalesStaffId || null, fromPresalesName || null,
     toStaffId, toName, qualifyingIds, transferType]
  );
}

module.exports = {
  checkAndTransfer, checkAndTransferPresales,
  pickNextPresales, coversAllSlots, qualifiesForSlotMode, getSlotMode,
};

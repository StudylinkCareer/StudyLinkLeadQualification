// Server/src/services/eventBudget.js
// ─────────────────────────────────────────────────────────────────────
// CRUD for the per-event budget ledger (event_budget_items) and the
// top-line figures on events (total_sponsorship, khach_k_count). Powers the
// Budget section of the Event Report page.
//
// Total Cost is NOT a stored figure — it's SUM(event_budget_items.amount)
// per budget_type ('planned' | 'actual'), computed on every read, so it can
// never drift out of sync with the ledger below it (a real bug in V1, where
// Total Cost was a separately-typed field disconnected from the line items).
//
// "Ngân sách sự kiện 85%" and "Tiền còn lại" are pure derivations of
// total_sponsorship and the ACTUAL cost total (real money left after real
// spend, not against the plan) - computed here, never stored.
// ─────────────────────────────────────────────────────────────────────
const { Pool } = require('pg');
const { parseBudgetCsv } = require('./budgetCsvImport');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const BUDGET_TYPES = new Set(['planned', 'actual']);

function withDerived(totalCostPlanned, totalCostActual, totalSponsorship, khachKCount) {
  const planned = totalCostPlanned != null ? Number(totalCostPlanned) : null;
  const actual = totalCostActual != null ? Number(totalCostActual) : null;
  const sponsorship = totalSponsorship != null ? Number(totalSponsorship) : null;
  const budget85 = sponsorship != null ? Math.round(sponsorship * 0.85) : null;
  const remaining = budget85 != null && actual != null ? budget85 - actual : null;
  return {
    totalCostPlanned: planned,
    totalCostActual: actual,
    totalSponsorship: sponsorship,
    khachKCount: khachKCount != null ? Number(khachKCount) : null,
    budget85,
    remaining,
  };
}

// api.js's request() only camelCases the TOP LEVEL of data.data — it doesn't
// recurse into nested arrays (see caseConvert.js objectToCamelCase, which is
// shallow). Budget items are nested under `items`, so camelCase them here.
function camelItem(row) {
  return {
    id: row.id,
    category: row.category,
    lineItem: row.line_item,
    unit: row.unit,
    unitPrice: row.unit_price != null ? Number(row.unit_price) : null,
    quantity: row.quantity != null ? Number(row.quantity) : null,
    amount: Number(row.amount),
    note: row.note,
    budgetType: row.budget_type,
    approvalNote: row.approval_note,
    approvalNoteBy: row.approval_note_by,
    approvalNoteAt: row.approval_note_at,
  };
}

// canApprove is a plain boolean computed by the route layer (via
// eventBudgetApproval.isApprover(req.session.staffEmail)) — this service
// stays decoupled from auth/session concerns, it just echoes the flag back
// alongside the approval state so the frontend can gate the Duyệt UI.
async function getBudget(eventId, canApprove = false) {
  const [evRes, sumsRes, itemsRes, sponsorSumRes] = await Promise.all([
    pool.query(
      `SELECT total_sponsorship, khach_k_count,
              budget_planned_approved_at, budget_planned_approved_by,
              budget_actual_approved_at, budget_actual_approved_by
         FROM events WHERE id = $1`,
      [eventId]
    ),
    pool.query(
      `SELECT
         SUM(amount) FILTER (WHERE budget_type = 'planned') AS planned_total,
         SUM(amount) FILTER (WHERE budget_type = 'actual')  AS actual_total
       FROM event_budget_items WHERE event_id = $1`,
      [eventId]
    ),
    pool.query(
      `SELECT id, category, line_item, unit, unit_price, quantity, amount, note, budget_type,
              approval_note, approval_note_by, approval_note_at
         FROM event_budget_items WHERE event_id = $1
        ORDER BY budget_type, category, id`,
      [eventId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_vnd), 0) AS total
         FROM event_institution_sponsors WHERE event_id = $1`,
      [eventId]
    ),
  ]);
  if (evRes.rowCount === 0) return null;
  const ev = evRes.rows[0];
  const { total_sponsorship, khach_k_count } = ev;
  const { planned_total, actual_total } = sumsRes.rows[0];
  // Sponsorship is computed from the per-institution breakdown once it has
  // any rows (can't drift out of sync, same fix as Total Cost above) —
  // falling back to the old manually-typed events.total_sponsorship only for
  // events that haven't had their breakdown entered/imported yet, so
  // existing figures don't silently disappear mid-migration.
  const hasSponsorBreakdown = sponsorSumRes.rows[0].n > 0;
  const sponsorship = hasSponsorBreakdown ? Number(sponsorSumRes.rows[0].total) : total_sponsorship;
  return {
    ...withDerived(planned_total, actual_total, sponsorship, khach_k_count),
    sponsorshipSource: hasSponsorBreakdown ? 'computed' : 'manual',
    items: itemsRes.rows.map(camelItem),
    canApprove,
    plannedApproval: ev.budget_planned_approved_at
      ? { approvedAt: ev.budget_planned_approved_at, approvedBy: ev.budget_planned_approved_by }
      : null,
    actualApproval: ev.budget_actual_approved_at
      ? { approvedAt: ev.budget_actual_approved_at, approvedBy: ev.budget_actual_approved_by }
      : null,
  };
}

async function setTotals(eventId, { totalSponsorship, khachKCount }, canApprove = false) {
  await pool.query(
    `UPDATE events SET total_sponsorship = $2, khach_k_count = $3 WHERE id = $1`,
    [eventId, totalSponsorship ?? null, khachKCount ?? null]
  );
  return getBudget(eventId, canApprove);
}

async function addItem(eventId, item) {
  const { category, lineItem, unit, unitPrice, quantity, amount, note, budgetType } = item;
  if (!category || !lineItem || amount == null) {
    throw new Error('category, lineItem and amount are required');
  }
  const type = BUDGET_TYPES.has(budgetType) ? budgetType : 'actual';
  const r = await pool.query(
    `INSERT INTO event_budget_items (event_id, category, line_item, unit, unit_price, quantity, amount, note, budget_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, category, line_item, unit, unit_price, quantity, amount, note, budget_type`,
    [eventId, category, lineItem, unit || null, unitPrice ?? null, quantity ?? null, amount, note || null, type]
  );
  return camelItem(r.rows[0]);
}

async function updateItem(eventId, itemId, item) {
  const { category, lineItem, unit, unitPrice, quantity, amount, note, budgetType } = item;
  const type = BUDGET_TYPES.has(budgetType) ? budgetType : 'actual';
  const r = await pool.query(
    `UPDATE event_budget_items
        SET category = $3, line_item = $4, unit = $5, unit_price = $6,
            quantity = $7, amount = $8, note = $9, budget_type = $10, updated_at = NOW()
      WHERE id = $1 AND event_id = $2
      RETURNING id, category, line_item, unit, unit_price, quantity, amount, note, budget_type`,
    [itemId, eventId, category, lineItem, unit || null, unitPrice ?? null, quantity ?? null, amount, note || null, type]
  );
  return r.rows[0] ? camelItem(r.rows[0]) : null;
}

async function deleteItem(eventId, itemId) {
  const r = await pool.query(
    `DELETE FROM event_budget_items WHERE id = $1 AND event_id = $2`,
    [itemId, eventId]
  );
  return r.rowCount > 0;
}

// importBudgetCsv(eventId, csvText) — parses the team's real budget
// spreadsheet export and REPLACES the line items for whichever budget
// type(s) are present in the file (planned always; actual only if the file
// has a THỰC TẾ column set — a pre-event "Kế hoạch" file has no actual
// column at all, so uploading it must not wipe out actuals entered since).
// Sponsorship auto-fills from the file's own "Tổng tiền tài trợ" row when
// present, per the agreed import behavior — still editable afterward.
async function importBudgetCsv(eventId, csvText, canApprove = false) {
  const { plannedItems, actualItems, totalSponsorship, hasActualColumns } = parseBudgetCsv(csvText);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`DELETE FROM event_budget_items WHERE event_id = $1 AND budget_type = 'planned'`, [eventId]);
    for (const item of plannedItems) {
      await client.query(
        `INSERT INTO event_budget_items (event_id, category, line_item, unit, unit_price, quantity, amount, note, budget_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'planned')`,
        [eventId, item.category, item.lineItem, item.unit, item.unitPrice, item.quantity, item.amount, item.note]
      );
    }

    if (hasActualColumns) {
      await client.query(`DELETE FROM event_budget_items WHERE event_id = $1 AND budget_type = 'actual'`, [eventId]);
      for (const item of actualItems) {
        await client.query(
          `INSERT INTO event_budget_items (event_id, category, line_item, unit, unit_price, quantity, amount, note, budget_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'actual')`,
          [eventId, item.category, item.lineItem, item.unit, item.unitPrice, item.quantity, item.amount, item.note]
        );
      }
    }

    if (totalSponsorship != null) {
      await client.query(`UPDATE events SET total_sponsorship = $2 WHERE id = $1`, [eventId, totalSponsorship]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return {
    budget: await getBudget(eventId, canApprove),
    summary: {
      plannedCount: plannedItems.length,
      actualCount: hasActualColumns ? actualItems.length : null,
      sponsorshipImported: totalSponsorship != null,
    },
  };
}

module.exports = { getBudget, setTotals, addItem, updateItem, deleteItem, importBudgetCsv, BUDGET_TYPES };

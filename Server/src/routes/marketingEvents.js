// server/src/routes/marketingEvents.js
// ─────────────────────────────────────────────────────────────────────
// CRUD for marketing events (lookup_values WHERE category='referral_source').
// Restricted to Admin / Manager / Director roles for write operations.
//
// Dates are stored in the `meta` JSONB column in ISO YYYY-MM-DD format:
//   { startDate, endDate, manualShowDate }
//
// VISIBILITY LIFECYCLE per event (computed, not stored):
//   - Before startDate                       → hidden
//   - startDate ≤ today ≤ endDate + 1 day    → visible (auto-active)
//   - After endDate + 1 day                  → hidden
//   - manualShowDate === today               → visible (one-day override)
//   - Override is single-day. Tomorrow it auto-hides again. Manager can
//     re-activate any number of times.
//
// Routes:
//   GET    /api/marketing-events/public  — PUBLIC, no auth. Non-hidden events
//                                          only. Used by LQ Home + Personal
//                                          Details dropdown.
//   GET    /api/marketing-events         — Admin/Mgr/Dir. All events with
//                                          computed `hidden` flag for admin UI.
//   POST   /api/marketing-events         — Create or reactivate
//   PUT    /api/marketing-events/:id     — Update labels, dates, OR
//                                          manualShowDate (the one-day override)
//   DELETE /api/marketing-events/:id     — Soft delete
// ─────────────────────────────────────────────────────────────────────

const express  = require('express');
const router   = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});


const ALLOWED_ROLES = new Set(['Admin', 'Manager', 'Director']);
function requireMarketingRole(req, res, next) {
  if (!req.session?.staffId) return res.status(401).json({ success: false, error: 'Not authenticated' });
  if (!ALLOWED_ROLES.has(req.session.staffRole)) return res.status(403).json({ success: false, error: 'Insufficient role' });
  next();
}

// ── Date helpers ─────────────────────────────────────────────
function todayISO() {
  return new Date().toISOString().slice(0, 10);  // YYYY-MM-DD (UTC)
}

function addDays(dateStr, n) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the `hidden` flag for an event given its meta JSONB.
 * Pure function — relies only on input + today's date.
 */
function computeHidden(meta) {
  const today          = todayISO();
  const startDate      = meta?.startDate      || null;
  const endDate        = meta?.endDate        || null;
  const manualShowDate = meta?.manualShowDate || null;

  // Manual override for today wins over everything else
  if (manualShowDate === today) return false;

  // No date constraints → always visible (rare; admins can leave dates blank)
  if (!startDate && !endDate) return false;

  // Pre-event window: hidden until midnight of startDate
  if (startDate && today < startDate) return true;

  // Post-event window: active until end+1 inclusive, hidden from end+2 onward
  if (endDate && today > addDays(endDate, 1)) return true;

  // Inside the auto-active window
  return false;
}

// Helper: build the row shape returned to the client.
function shapeRow(r) {
  const meta = r.meta || {};
  return {
    id:             r.id,
    code:           r.code,
    labelEn:        r.label_en,
    labelVi:        r.label_vi,
    sortOrder:      r.sort_order,
    isActive:       r.is_active,
    startDate:      meta.startDate      || null,
    endDate:        meta.endDate        || null,
    manualShowDate: meta.manualShowDate || null,
    hidden:         computeHidden(meta),
  };
}


// ── PUBLIC list (no auth) — non-hidden events only ───────────
// IMPORTANT: this route is declared before /:id so it doesn't get
// captured as a numeric id.
router.get('/public', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, code, label_en, label_vi, sort_order, meta
         FROM lookup_values
        WHERE category = 'referral_source' AND is_active = true
        ORDER BY sort_order DESC, code ASC`
    );
    const visible = r.rows
      .filter(row => !computeHidden(row.meta))
      .map(row => ({
        code:    row.code,
        labelEn: row.label_en,
        labelVi: row.label_vi,
      }));
    res.json({ success: true, data: visible });
  } catch (err) {
    console.error('[marketingEvents] public list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load events' });
  }
});


// ── List (authenticated, admin UI) ──────────────────────────
router.get('/', requireMarketingRole, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, code, label_en, label_vi, sort_order, is_active, meta
         FROM lookup_values
        WHERE category = 'referral_source' AND is_active = true
        ORDER BY sort_order DESC, code ASC`
    );
    res.json({ success: true, data: r.rows.map(shapeRow) });
  } catch (err) {
    console.error('[marketingEvents] list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load events' });
  }
});


// ── Create / reactivate ─────────────────────────────────────
router.post('/', requireMarketingRole, async (req, res) => {
  const code      = (req.body.code      || '').trim();
  const labelEn   = (req.body.labelEn   || '').trim() || null;
  const labelVi   = (req.body.labelVi   || '').trim() || null;
  const startDate = (req.body.startDate || '').trim() || null;
  const endDate   = (req.body.endDate   || '').trim() || null;

  if (!code) {
    return res.status(400).json({ success: false, error: 'Event name (code) is required' });
  }
  if (code.length > 200) {
    return res.status(400).json({ success: false, error: 'Event name must be 200 characters or fewer' });
  }

  const meta = {};
  if (startDate) meta.startDate = startDate;
  if (endDate)   meta.endDate   = endDate;

  try {
    const nextRes = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
         FROM lookup_values WHERE category = 'referral_source'`
    );
    const nextSort = nextRes.rows[0].next;

    const ins = await pool.query(
      `INSERT INTO lookup_values (category, code, label_en, label_vi, sort_order, is_active, meta)
       VALUES ('referral_source', $1, $2, $3, $4, true, $5::jsonb)
       RETURNING id, code, label_en, label_vi, sort_order, is_active, meta`,
      [code, labelEn, labelVi, nextSort, JSON.stringify(meta)]
    );

    res.json({ success: true, data: shapeRow(ins.rows[0]) });
  } catch (err) {
    if (err.code === '23505') {
      // Row exists (possibly soft-deleted). Reactivate + refresh labels/dates.
      try {
        const re = await pool.query(
          `UPDATE lookup_values
              SET is_active = true,
                  label_en  = $1,
                  label_vi  = $2,
                  meta      = COALESCE(meta, '{}'::jsonb) || $3::jsonb
            WHERE category = 'referral_source'
              AND COALESCE(subcategory, '') = ''
              AND code = $4
            RETURNING id, code, label_en, label_vi, sort_order, is_active, meta`,
          [labelEn, labelVi, JSON.stringify(meta), code]
        );
        if (re.rowCount > 0) {
          return res.json({ success: true, data: shapeRow(re.rows[0]), reactivated: true });
        }
      } catch (e2) {
        console.error('[marketingEvents] reactivation failed:', e2);
      }
      return res.status(409).json({ success: false, error: 'An event with that name already exists' });
    }
    console.error('[marketingEvents] create failed:', err);
    res.status(500).json({ success: false, error: 'Failed to create event' });
  }
});


// ── Update (labels, dates, OR manualShowDate) ───────────────
// Any subset of fields can be provided. The meta JSONB is merged
// rather than replaced so we don't drop sibling keys.
router.put('/:id', requireMarketingRole, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });

  const labelEn        = req.body.labelEn        !== undefined ? (String(req.body.labelEn).trim()        || null) : undefined;
  const labelVi        = req.body.labelVi        !== undefined ? (String(req.body.labelVi).trim()        || null) : undefined;
  const startDate      = req.body.startDate      !== undefined ? (String(req.body.startDate).trim()      || null) : undefined;
  const endDate        = req.body.endDate        !== undefined ? (String(req.body.endDate).trim()        || null) : undefined;
  const manualShowDate = req.body.manualShowDate !== undefined ? (String(req.body.manualShowDate).trim() || null) : undefined;

  if (labelEn === undefined && labelVi === undefined
      && startDate === undefined && endDate === undefined
      && manualShowDate === undefined) {
    return res.status(400).json({ success: false, error: 'No fields to update' });
  }

  try {
    // Load existing meta so we can merge without dropping sibling keys.
    const existing = await pool.query(
      `SELECT meta FROM lookup_values WHERE id = $1 AND category = 'referral_source'`,
      [id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ success: false, error: 'Event not found' });

    const meta = existing.rows[0].meta || {};
    if (startDate      !== undefined) { if (startDate)      meta.startDate      = startDate;      else delete meta.startDate; }
    if (endDate        !== undefined) { if (endDate)        meta.endDate        = endDate;        else delete meta.endDate; }
    if (manualShowDate !== undefined) { if (manualShowDate) meta.manualShowDate = manualShowDate; else delete meta.manualShowDate; }

    const sets = [], vals = [];
    if (labelEn !== undefined) { vals.push(labelEn); sets.push(`label_en = $${vals.length}`); }
    if (labelVi !== undefined) { vals.push(labelVi); sets.push(`label_vi = $${vals.length}`); }
    if (startDate !== undefined || endDate !== undefined || manualShowDate !== undefined) {
      vals.push(JSON.stringify(meta)); sets.push(`meta = $${vals.length}::jsonb`);
    }
    vals.push(id);

    const upd = await pool.query(
      `UPDATE lookup_values SET ${sets.join(', ')}
         WHERE id = $${vals.length} AND category = 'referral_source'
         RETURNING id, code, label_en, label_vi, sort_order, is_active, meta`,
      vals
    );
    if (upd.rowCount === 0) return res.status(404).json({ success: false, error: 'Event not found' });
    res.json({ success: true, data: shapeRow(upd.rows[0]) });
  } catch (err) {
    console.error('[marketingEvents] update failed:', err);
    res.status(500).json({ success: false, error: 'Failed to update event' });
  }
});


// ── Soft delete ──────────────────────────────────────────────
router.delete('/:id', requireMarketingRole, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });

  try {
    const upd = await pool.query(
      `UPDATE lookup_values SET is_active = false
         WHERE id = $1 AND category = 'referral_source'
         RETURNING id`,
      [id]
    );
    if (upd.rowCount === 0) return res.status(404).json({ success: false, error: 'Event not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[marketingEvents] delete failed:', err);
    res.status(500).json({ success: false, error: 'Failed to delete event' });
  }
});

module.exports = router;

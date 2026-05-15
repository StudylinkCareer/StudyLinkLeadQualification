// server/src/routes/marketingEvents.js
// ─────────────────────────────────────────────────────────────────────
// CRUD for marketing events (lookup_values WHERE category='referral_source').
// Restricted to Admin / Manager / Director roles.
//
// Dates are stored in the `meta` JSONB column as { startDate, endDate }
// in ISO YYYY-MM-DD format. Either or both can be omitted.
//
// Routes:
//   GET    /api/marketing-events       — list active events, ordered by sort_order ASC
//   POST   /api/marketing-events       — create or reactivate
//   PUT    /api/marketing-events/:id   — update labels + dates (code stays fixed)
//   DELETE /api/marketing-events/:id   — soft delete
// ─────────────────────────────────────────────────────────────────────

const express  = require('express');
const router   = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const lookupCtrl = require('../controllers/lookupController');

const ALLOWED_ROLES = new Set(['Admin', 'Manager', 'Director']);
function requireMarketingRole(req, res, next) {
  if (!req.session?.staffId) return res.status(401).json({ success: false, error: 'Not authenticated' });
  if (!ALLOWED_ROLES.has(req.session.staffRole)) return res.status(403).json({ success: false, error: 'Insufficient role' });
  next();
}

// Helper: build the row shape returned to the client.
// startDate/endDate are unpacked from meta JSONB.
function shapeRow(r) {
  return {
    id:        r.id,
    code:      r.code,
    labelEn:   r.label_en,
    labelVi:   r.label_vi,
    sortOrder: r.sort_order,
    isActive:  r.is_active,
    startDate: r.meta?.startDate || null,
    endDate:   r.meta?.endDate   || null,
  };
}

// ── List ─────────────────────────────────────────────────────
router.get('/', requireMarketingRole, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, code, label_en, label_vi, sort_order, is_active, meta
         FROM lookup_values
        WHERE category = 'referral_source' AND is_active = true
        ORDER BY sort_order ASC, code ASC`
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

    if (lookupCtrl.bustCache) lookupCtrl.bustCache();
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
                  meta      = $3::jsonb
            WHERE category = 'referral_source'
              AND COALESCE(subcategory, '') = ''
              AND code = $4
            RETURNING id, code, label_en, label_vi, sort_order, is_active, meta`,
          [labelEn, labelVi, JSON.stringify(meta), code]
        );
        if (re.rowCount > 0) {
          if (lookupCtrl.bustCache) lookupCtrl.bustCache();
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

// ── Update (labels + dates; code stays fixed) ───────────────
router.put('/:id', requireMarketingRole, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });

  const labelEn   = req.body.labelEn   !== undefined ? (String(req.body.labelEn).trim()   || null) : undefined;
  const labelVi   = req.body.labelVi   !== undefined ? (String(req.body.labelVi).trim()   || null) : undefined;
  const startDate = req.body.startDate !== undefined ? (String(req.body.startDate).trim() || null) : undefined;
  const endDate   = req.body.endDate   !== undefined ? (String(req.body.endDate).trim()   || null) : undefined;

  if (labelEn === undefined && labelVi === undefined && startDate === undefined && endDate === undefined) {
    return res.status(400).json({ success: false, error: 'No fields to update' });
  }

  try {
    // Load existing meta so we can merge dates without dropping other keys.
    const existing = await pool.query(
      `SELECT meta FROM lookup_values WHERE id = $1 AND category = 'referral_source'`,
      [id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ success: false, error: 'Event not found' });

    const meta = existing.rows[0].meta || {};
    if (startDate !== undefined) {
      if (startDate) meta.startDate = startDate; else delete meta.startDate;
    }
    if (endDate !== undefined) {
      if (endDate) meta.endDate = endDate; else delete meta.endDate;
    }

    const sets = [], vals = [];
    if (labelEn !== undefined) { vals.push(labelEn); sets.push(`label_en = $${vals.length}`); }
    if (labelVi !== undefined) { vals.push(labelVi); sets.push(`label_vi = $${vals.length}`); }
    if (startDate !== undefined || endDate !== undefined) {
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
    if (lookupCtrl.bustCache) lookupCtrl.bustCache();
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
    if (lookupCtrl.bustCache) lookupCtrl.bustCache();
    res.json({ success: true });
  } catch (err) {
    console.error('[marketingEvents] delete failed:', err);
    res.status(500).json({ success: false, error: 'Failed to delete event' });
  }
});

module.exports = router;

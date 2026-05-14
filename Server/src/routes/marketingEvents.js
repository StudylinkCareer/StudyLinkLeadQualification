// server/src/routes/marketingEvents.js
// ─────────────────────────────────────────────────────────────────────
// Minimal CRUD for the Marketing Events list (lookup_values WHERE
// category='referral_source'). Lets any authenticated staff list, add,
// rename, or soft-delete events — no Admin role required since this is
// a marketing-operations tool, not a system admin tool.
//
// Routes:
//   GET    /api/marketing-events       — list active events, ordered by sort_order ASC
//   POST   /api/marketing-events       — create a new event {code, labelEn?, labelVi?}
//   PUT    /api/marketing-events/:id   — rename {labelEn?, labelVi?}
//   DELETE /api/marketing-events/:id   — soft delete (sets is_active = false)
// ─────────────────────────────────────────────────────────────────────

const express  = require('express');
const router   = express.Router();
const { Pool } = require('pg');

// Match the pool pattern used by lookupController.js — each file owns its pool.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Pull the cache-buster from lookupController so list/get reflect changes immediately.
const lookupCtrl = require('../controllers/lookupController');

function requireStaffAuth(req, res, next) {
  if (!req.session?.staffId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  next();
}

// Restrict marketing-event management to leadership roles.
// Counselor / Senior Counselor / other roles get 403 even if logged in.
const ALLOWED_ROLES = new Set(['Admin', 'Manager', 'Director']);
function requireMarketingRole(req, res, next) {
  if (!req.session?.staffId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  if (!ALLOWED_ROLES.has(req.session.staffRole)) {
    return res.status(403).json({ success: false, error: 'Insufficient role' });
  }
  next();
}

// ── List ─────────────────────────────────────────────────────
router.get('/', requireMarketingRole, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, code, label_en AS "labelEn", label_vi AS "labelVi", sort_order AS "sortOrder", is_active
         FROM lookup_values
        WHERE category = 'referral_source' AND is_active = true
        ORDER BY sort_order ASC, code ASC`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[marketingEvents] list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load events' });
  }
});

// ── Create ───────────────────────────────────────────────────
router.post('/', requireMarketingRole, async (req, res) => {
  const code    = (req.body.code    || '').trim();
  const labelEn = (req.body.labelEn || '').trim() || null;
  const labelVi = (req.body.labelVi || '').trim() || null;

  if (!code) {
    return res.status(400).json({ success: false, error: 'Event name (code) is required' });
  }
  if (code.length > 200) {
    return res.status(400).json({ success: false, error: 'Event name must be 200 characters or fewer' });
  }

  try {
    // Next sort_order = current MAX + 1 (so new entries appear last = "latest")
    const nextRes = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM lookup_values WHERE category = 'referral_source'`
    );
    const nextSort = nextRes.rows[0].next;

    const ins = await pool.query(
      `INSERT INTO lookup_values (category, code, label_en, label_vi, sort_order, is_active)
       VALUES ('referral_source', $1, $2, $3, $4, true)
       RETURNING id, code, label_en AS "labelEn", label_vi AS "labelVi", sort_order AS "sortOrder", is_active`,
      [code, labelEn, labelVi, nextSort]
    );

    if (lookupCtrl.bustCache) lookupCtrl.bustCache();   // refresh /api/lookups cache for clients
    res.json({ success: true, data: ins.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      // unique violation on (category, subcategory, code)
      return res.status(409).json({ success: false, error: 'An event with that name already exists' });
    }
    console.error('[marketingEvents] create failed:', err);
    res.status(500).json({ success: false, error: 'Failed to create event' });
  }
});

// ── Rename labels ────────────────────────────────────────────
router.put('/:id', requireMarketingRole, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });

  const labelEn = req.body.labelEn !== undefined ? (String(req.body.labelEn).trim() || null) : undefined;
  const labelVi = req.body.labelVi !== undefined ? (String(req.body.labelVi).trim() || null) : undefined;

  if (labelEn === undefined && labelVi === undefined) {
    return res.status(400).json({ success: false, error: 'No fields to update' });
  }

  try {
    const sets = [], vals = [];
    if (labelEn !== undefined) { vals.push(labelEn); sets.push(`label_en = $${vals.length}`); }
    if (labelVi !== undefined) { vals.push(labelVi); sets.push(`label_vi = $${vals.length}`); }
    vals.push(id);
    const upd = await pool.query(
      `UPDATE lookup_values SET ${sets.join(', ')}
         WHERE id = $${vals.length} AND category = 'referral_source'
         RETURNING id, code, label_en AS "labelEn", label_vi AS "labelVi", sort_order AS "sortOrder", is_active`,
      vals
    );
    if (upd.rowCount === 0) return res.status(404).json({ success: false, error: 'Event not found' });
    if (lookupCtrl.bustCache) lookupCtrl.bustCache();
    res.json({ success: true, data: upd.rows[0] });
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

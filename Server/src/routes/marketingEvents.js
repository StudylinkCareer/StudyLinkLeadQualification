// server/src/routes/marketingEvents.js
// ─────────────────────────────────────────────────────────────────────
// Events admin — manages the `events` table (the event catalog), now in
// FLAT format: a single Event Type + Event name (no Group → Type nesting).
// Route mount unchanged: /api/marketing-events.
//
// Event Type options are marketing-editable reference data
// (lookup_values category='event_type', subcategory = NULL), served by
// GET /event-types and extended via POST /event-types.
//
// Flat events store event_group = event_type (the group column is retained
// for back-compat / NOT NULL + the existing UNIQUE(group,type,name); with
// group mirrored to type, uniqueness is effectively (type, name)).
//
// Dates live in real columns. Manual visibility overrides live in meta JSONB
// { manualShowDate, manualHideDate }. Optional display labels (label_en/
// label_vi) and dedicated_counsellor are real columns (counsellor feeds the
// event QR in R2b).
//
// VISIBILITY LIFECYCLE per event (computed, not stored):
//   - manualHideDate === today → hidden ; manualShowDate === today → visible
//   - else auto: before start → hidden ; start ≤ today ≤ end+1 → visible ;
//     after end+1 → hidden. Overrides are single-day.
//
// Routes:
//   GET    /event-types  — PUBLIC. Flat Event Type list.
//   POST   /event-types  — Admin/Mgr/Dir. Add (or reactivate) an Event Type.
//   GET    /taxonomy     — PUBLIC. (Legacy group→type; kept for current LQ.)
//   GET    /public       — PUBLIC. Visible events (?eventType= optional).
//   GET    /             — Admin/Mgr/Dir. All active events.
//   POST   /             — Create / reactivate.
//   PUT    /:id          — Update type/name/labels/counsellor/dates/override.
//   DELETE /:id          — Soft delete.
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
function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDays(dateStr, n) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function computeHidden(startDate, endDate, meta) {
  const today = todayISO();
  const manualShowDate = meta?.manualShowDate || null;
  const manualHideDate = meta?.manualHideDate || null;
  if (manualHideDate === today) return true;
  if (manualShowDate === today) return false;
  if (!startDate && !endDate) return false;
  if (startDate && today < startDate) return true;
  if (endDate && today > addDays(endDate, 1)) return true;
  return false;
}

const COLS = `id, event_group, event_type, name, label_en, label_vi, dedicated_counsellor,
              to_char(start_date, 'YYYY-MM-DD') AS start_date,
              to_char(end_date,   'YYYY-MM-DD') AS end_date,
              meta, is_active`;

function shapeRow(r) {
  const meta = r.meta || {};
  return {
    id:                  r.id,
    eventType:           r.event_type,
    name:                r.name,
    labelEn:             r.label_en || null,
    labelVi:             r.label_vi || null,
    dedicatedCounsellor: r.dedicated_counsellor || null,
    startDate:           r.start_date || null,
    endDate:             r.end_date   || null,
    manualShowDate:      meta.manualShowDate || null,
    manualHideDate:      meta.manualHideDate || null,
    isActive:            r.is_active,
    hidden:              computeHidden(r.start_date, r.end_date, meta),
  };
}

const norm = (v) => { const s = (v ?? '').toString().trim(); return s === '' ? null : s; };


// ── Event Types (flat reference list) ────────────────────────
router.get('/event-types', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT code, label_en, label_vi FROM lookup_values
        WHERE category='event_type' AND subcategory IS NULL AND is_active=true
        ORDER BY sort_order ASC, code ASC`
    );
    res.json({ success: true, data: r.rows.map(x => ({ code: x.code, labelEn: x.label_en, labelVi: x.label_vi })) });
  } catch (err) {
    console.error('[events] event-types failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load event types' });
  }
});

router.post('/event-types', requireMarketingRole, async (req, res) => {
  const code = norm(req.body.code);
  if (!code) return res.status(400).json({ success: false, error: 'Type name is required' });
  if (code.length > 100) return res.status(400).json({ success: false, error: 'Type name too long' });
  try {
    const hit = await pool.query(
      `SELECT id, is_active FROM lookup_values WHERE category='event_type' AND subcategory IS NULL AND code=$1`, [code]);
    if (hit.rowCount > 0) {
      if (!hit.rows[0].is_active) await pool.query(`UPDATE lookup_values SET is_active=true WHERE id=$1`, [hit.rows[0].id]);
      return res.json({ success: true, data: { code }, existed: true });
    }
    const ns = await pool.query(
      `SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM lookup_values WHERE category='event_type' AND subcategory IS NULL`);
    await pool.query(
      `INSERT INTO lookup_values (category, subcategory, code, label_en, label_vi, sort_order, is_active)
       VALUES ('event_type', NULL, $1, $1, $1, $2, true)`, [code, ns.rows[0].n]);
    res.json({ success: true, data: { code } });
  } catch (err) {
    console.error('[events] add event-type failed:', err);
    res.status(500).json({ success: false, error: 'Failed to add event type' });
  }
});


// ── Legacy taxonomy (kept for the current LQ form until R4) ───
router.get('/taxonomy', async (req, res) => {
  try {
    const groups = await pool.query(
      `SELECT code, label_en, label_vi FROM lookup_values
        WHERE category='event_group' AND is_active=true ORDER BY sort_order ASC, code ASC`);
    const types = await pool.query(
      `SELECT subcategory, code, label_en, label_vi FROM lookup_values
        WHERE category='event_type' AND subcategory IS NOT NULL AND is_active=true ORDER BY sort_order ASC, code ASC`);
    const typesByGroup = {};
    for (const r of types.rows) {
      if (!typesByGroup[r.subcategory]) typesByGroup[r.subcategory] = [];
      typesByGroup[r.subcategory].push({ code: r.code, labelEn: r.label_en, labelVi: r.label_vi });
    }
    res.json({ success: true, data: {
      groups: groups.rows.map(r => ({ code: r.code, labelEn: r.label_en, labelVi: r.label_vi })),
      typesByGroup,
    }});
  } catch (err) {
    console.error('[events] taxonomy failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load taxonomy' });
  }
});


// ── PUBLIC list (no auth) — visible events only ──────────────
router.get('/public', async (req, res) => {
  try {
    const eventType = norm(req.query.eventType ?? req.query.type);
    const conds = ['is_active = true'], params = [];
    if (eventType) { params.push(eventType); conds.push(`event_type = $${params.length}`); }
    const r = await pool.query(
      `SELECT ${COLS} FROM events WHERE ${conds.join(' AND ')}
        ORDER BY start_date DESC NULLS LAST, name ASC`, params);
    const visible = r.rows
      .filter(row => !computeHidden(row.start_date, row.end_date, row.meta))
      .map(row => ({
        id:        row.id,
        eventType: row.event_type,
        name:      row.name,
        labelEn:   row.label_en || null,
        labelVi:   row.label_vi || null,
        startDate: row.start_date || null,
        endDate:   row.end_date   || null,
        dedicatedCounsellor: row.dedicated_counsellor || null,
      }));
    res.json({ success: true, data: visible });
  } catch (err) {
    console.error('[events] public list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load events' });
  }
});


// ── List (authenticated, admin UI) ──────────────────────────
router.get('/', requireMarketingRole, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ${COLS} FROM events WHERE is_active = true
        ORDER BY start_date DESC NULLS LAST, name ASC`);
    res.json({ success: true, data: r.rows.map(shapeRow) });
  } catch (err) {
    console.error('[events] list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load events' });
  }
});


// ── Create / reactivate ─────────────────────────────────────
router.post('/', requireMarketingRole, async (req, res) => {
  const eventType  = norm(req.body.eventType ?? req.body.type);
  const name       = norm(req.body.name);
  const labelEn    = norm(req.body.labelEn);
  const labelVi    = norm(req.body.labelVi);
  const counsellor = norm(req.body.dedicatedCounsellor);
  const startDate  = norm(req.body.startDate);
  const endDate    = norm(req.body.endDate);

  if (!eventType || !name) return res.status(400).json({ success: false, error: 'Event type and event name are required' });
  if (name.length > 200) return res.status(400).json({ success: false, error: 'Event name must be 200 characters or fewer' });

  try {
    const ins = await pool.query(
      `INSERT INTO events (event_group, event_type, name, label_en, label_vi, dedicated_counsellor, start_date, end_date, meta, is_active)
       VALUES ($1, $1, $2, $3, $4, $5, $6::date, $7::date, '{}'::jsonb, true)
       RETURNING ${COLS}`,
      [eventType, name, labelEn, labelVi, counsellor, startDate, endDate]);
    res.json({ success: true, data: shapeRow(ins.rows[0]) });
  } catch (err) {
    if (err.code === '23505') {
      try {
        const re = await pool.query(
          `UPDATE events SET is_active=true, label_en=$3, label_vi=$4, dedicated_counsellor=$5,
                  start_date=$6::date, end_date=$7::date
            WHERE event_group=$1 AND event_type=$1 AND name=$2 RETURNING ${COLS}`,
          [eventType, name, labelEn, labelVi, counsellor, startDate, endDate]);
        if (re.rowCount > 0) return res.json({ success: true, data: shapeRow(re.rows[0]), reactivated: true });
      } catch (e2) { console.error('[events] reactivation failed:', e2); }
      return res.status(409).json({ success: false, error: 'That event already exists under this type' });
    }
    console.error('[events] create failed:', err);
    res.status(500).json({ success: false, error: 'Failed to create event' });
  }
});


// ── Update ───────────────────────────────────────────────────
router.put('/:id', requireMarketingRole, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });

  const eventType      = req.body.eventType      !== undefined ? norm(req.body.eventType)
                       : req.body.type           !== undefined ? norm(req.body.type) : undefined;
  const name           = req.body.name           !== undefined ? norm(req.body.name) : undefined;
  const labelEn        = req.body.labelEn         !== undefined ? norm(req.body.labelEn) : undefined;
  const labelVi        = req.body.labelVi         !== undefined ? norm(req.body.labelVi) : undefined;
  const counsellor     = req.body.dedicatedCounsellor !== undefined ? norm(req.body.dedicatedCounsellor) : undefined;
  const startDate      = req.body.startDate      !== undefined ? norm(req.body.startDate) : undefined;
  const endDate        = req.body.endDate        !== undefined ? norm(req.body.endDate) : undefined;
  const manualShowDate = req.body.manualShowDate !== undefined ? norm(req.body.manualShowDate) : undefined;
  const manualHideDate = req.body.manualHideDate !== undefined ? norm(req.body.manualHideDate) : undefined;

  if (eventType === undefined && name === undefined && labelEn === undefined && labelVi === undefined
      && counsellor === undefined && startDate === undefined && endDate === undefined
      && manualShowDate === undefined && manualHideDate === undefined) {
    return res.status(400).json({ success: false, error: 'No fields to update' });
  }
  if (name !== undefined && !name) return res.status(400).json({ success: false, error: 'Event name cannot be empty' });
  if (eventType !== undefined && !eventType) return res.status(400).json({ success: false, error: 'Event type cannot be empty' });

  try {
    const existing = await pool.query(`SELECT meta FROM events WHERE id=$1`, [id]);
    if (existing.rowCount === 0) return res.status(404).json({ success: false, error: 'Event not found' });

    const meta = existing.rows[0].meta || {};
    if (manualShowDate !== undefined) { if (manualShowDate) meta.manualShowDate = manualShowDate; else delete meta.manualShowDate; }
    if (manualHideDate !== undefined) { if (manualHideDate) meta.manualHideDate = manualHideDate; else delete meta.manualHideDate; }

    const sets = [], vals = [];
    if (eventType !== undefined) {                       // keep group mirrored to type
      vals.push(eventType); const p = vals.length;
      sets.push(`event_type = $${p}`); sets.push(`event_group = $${p}`);
    }
    if (name       !== undefined) { vals.push(name);       sets.push(`name = $${vals.length}`); }
    if (labelEn    !== undefined) { vals.push(labelEn);    sets.push(`label_en = $${vals.length}`); }
    if (labelVi    !== undefined) { vals.push(labelVi);    sets.push(`label_vi = $${vals.length}`); }
    if (counsellor !== undefined) { vals.push(counsellor); sets.push(`dedicated_counsellor = $${vals.length}`); }
    if (startDate  !== undefined) { vals.push(startDate);  sets.push(`start_date = $${vals.length}::date`); }
    if (endDate    !== undefined) { vals.push(endDate);    sets.push(`end_date = $${vals.length}::date`); }
    if (manualShowDate !== undefined || manualHideDate !== undefined) {
      vals.push(JSON.stringify(meta)); sets.push(`meta = $${vals.length}::jsonb`);
    }
    vals.push(id);

    const upd = await pool.query(
      `UPDATE events SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING ${COLS}`, vals);
    if (upd.rowCount === 0) return res.status(404).json({ success: false, error: 'Event not found' });
    res.json({ success: true, data: shapeRow(upd.rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, error: 'That event already exists under this type' });
    console.error('[events] update failed:', err);
    res.status(500).json({ success: false, error: 'Failed to update event' });
  }
});


// ── Soft delete ──────────────────────────────────────────────
router.delete('/:id', requireMarketingRole, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
  try {
    const upd = await pool.query(`UPDATE events SET is_active=false WHERE id=$1 RETURNING id`, [id]);
    if (upd.rowCount === 0) return res.status(404).json({ success: false, error: 'Event not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[events] delete failed:', err);
    res.status(500).json({ success: false, error: 'Failed to delete event' });
  }
});

module.exports = router;

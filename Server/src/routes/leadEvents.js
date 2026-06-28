// server/src/routes/leadEvents.js
// ─────────────────────────────────────────────────────────────────────
// Lead registrations (the lead_events join table). Mounted at
// /api/lead-events. One row per event a lead registered through, plus the
// per-event "how heard about this event" attribution.
//
//   GET    /api/lead-events?studentId=ID  — list a student's registrations
//   GET    /api/lead-events/options       — picker data (events + heard-via lists)
//   POST   /api/lead-events               — link an event to a student
//   PUT    /api/lead-events/:id           — patch status / how-heard fields
//   DELETE /api/lead-events/:id           — unlink
//
// Consumed by the self-contained <LeadEventsSection> card on Student/Lead Detail.
// Responses are camelCase (the component fetches raw, no case-conversion layer).
// ─────────────────────────────────────────────────────────────────────

const express  = require('express');
const router   = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

function requireStaff(req, res, next) {
  if (!req.session?.staffId) return res.status(401).json({ success: false, error: 'Not authenticated' });
  next();
}

const ALLOWED_STATUS = new Set(['Confirmed', 'Uncertain', 'Declined']);
const norm = (v) => { const s = (v ?? '').toString().trim(); return s === '' ? null : s; };

// One registration row -> camelCase shape the card expects.
const toJs = (r) => ({
  id:             r.id,
  eventId:        r.event_id,
  name:           r.name,
  group:          r.event_group,
  type:           r.event_type,
  startDate:      r.start_date,
  endDate:        r.end_date,
  status:         r.status,
  evHeardType:    r.ev_heard_type,
  evChannel:      r.ev_channel,
  evReferralKind: r.ev_referral_kind,
  evReferralWho:  r.ev_referral_who,
  sourceOfLead:   r.source_of_lead,
  source:         r.source,
  sourceDetail:   r.source_detail,
});

// ── List a student's registrations (newest first), joined to the catalog ──────
router.get('/', requireStaff, async (req, res) => {
  const studentId = (req.query.studentId || '').toString().trim();
  if (!studentId) return res.status(400).json({ success: false, error: 'studentId is required' });
  try {
    const r = await pool.query(
      `SELECT le.id, le.event_id, le.status,
              le.ev_heard_type, le.ev_channel, le.ev_referral_kind, le.ev_referral_who,
              le.source_of_lead, le.source, le.source_detail,
              e.name, e.event_group, e.event_type,
              to_char(e.start_date, 'YYYY-MM-DD') AS start_date,
              to_char(e.end_date,   'YYYY-MM-DD') AS end_date
         FROM lead_events le
         LEFT JOIN events e ON e.id = le.event_id
        WHERE le.student_id = $1
        ORDER BY le.created_at DESC, le.id DESC`,
      [studentId]
    );
    res.json({ success: true, data: r.rows.map(toJs) });
  } catch (err) {
    console.error('[leadEvents] list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load registrations' });
  }
});

// ── Picker data: events to link + the "heard about event via" option lists ────
router.get('/options', requireStaff, async (req, res) => {
  try {
    const [ev, ch, sa, pa] = await Promise.all([
      pool.query(`SELECT id, name, event_group, event_type FROM events
                   WHERE is_active = true
                   ORDER BY COALESCE(start_date, created_at) DESC, name`),
      pool.query(`SELECT label_en FROM lookup_values
                   WHERE category = 'source' AND is_active = true
                   ORDER BY sort_order, code`),
      pool.query(`SELECT id, name FROM subagents WHERE is_active = true ORDER BY name`),
      pool.query(`SELECT id, name FROM partners  WHERE is_active = true ORDER BY name`),
    ]);
    res.json({
      success: true,
      data: {
        events:    ev.rows.map(e => ({ id: e.id, name: e.name, group: e.event_group, type: e.event_type })),
        channels:  ch.rows.map(r => r.label_en),
        subagents: sa.rows.map(r => ({ id: r.id, name: r.name })),
        partners:  pa.rows.map(r => ({ id: r.id, name: r.name })),
      },
    });
  } catch (err) {
    console.error('[leadEvents] options failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load options' });
  }
});

// ── Link an event to a student ────────────────────────────────────────────────
router.post('/', requireStaff, async (req, res) => {
  const { studentId, eventId } = req.body || {};
  if (!studentId || !eventId) return res.status(400).json({ success: false, error: 'studentId and eventId are required' });
  const status = norm(req.body.status);
  if (status && !ALLOWED_STATUS.has(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
  try {
    const ins = await pool.query(
      `INSERT INTO lead_events
         (student_id, event_id, status, ev_heard_type, ev_channel, ev_referral_kind, ev_referral_who, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
       RETURNING id`,
      [String(studentId), Number(eventId), status,
       norm(req.body.evHeardType), norm(req.body.evChannel),
       norm(req.body.evReferralKind), norm(req.body.evReferralWho)]
    );
    res.json({ success: true, data: { id: ins.rows[0].id } });
  } catch (err) {
    console.error('[leadEvents] create failed:', err);
    res.status(500).json({ success: false, error: 'Failed to add event' });
  }
});

// ── Patch status / how-heard fields (partial; only sent keys are written) ──────
const PATCHABLE = {
  status:         'status',
  evHeardType:    'ev_heard_type',
  evChannel:      'ev_channel',
  evReferralKind: 'ev_referral_kind',
  evReferralWho:  'ev_referral_who',
};
router.put('/:id', requireStaff, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
  if (req.body.status !== undefined) {
    const s = norm(req.body.status);
    if (s && !ALLOWED_STATUS.has(s)) return res.status(400).json({ success: false, error: 'Invalid status' });
  }
  const sets = [], vals = [];
  for (const [jsKey, col] of Object.entries(PATCHABLE)) {
    if (jsKey in (req.body || {})) { vals.push(norm(req.body[jsKey])); sets.push(`${col} = $${vals.length}`); }
  }
  if (!sets.length) return res.status(400).json({ success: false, error: 'No fields to update' });
  vals.push(id);
  try {
    const upd = await pool.query(
      `UPDATE lead_events SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length} RETURNING id`,
      vals
    );
    if (upd.rowCount === 0) return res.status(404).json({ success: false, error: 'Registration not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[leadEvents] update failed:', err);
    res.status(500).json({ success: false, error: 'Failed to update' });
  }
});

// ── Unlink ────────────────────────────────────────────────────────────────────
router.delete('/:id', requireStaff, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
  try {
    const del = await pool.query(`DELETE FROM lead_events WHERE id = $1 RETURNING id`, [id]);
    if (del.rowCount === 0) return res.status(404).json({ success: false, error: 'Registration not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[leadEvents] delete failed:', err);
    res.status(500).json({ success: false, error: 'Failed to delete' });
  }
});

module.exports = router;

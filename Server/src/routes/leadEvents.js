// server/src/routes/leadEvents.js
// ─────────────────────────────────────────────────────────────────────
// Lead registrations (the lead_events join table). Mounted at
// /api/lead-events. One row per event/source a lead registered through.
//   GET /api/lead-events/:studentId   — list a lead's registrations
//   PUT /api/lead-events/:id/status   — update attendance status only
// Display fields (source of lead / source / event / dates) are read-only;
// rows are created by the LQ form (R4) and the Phase 3 backfill.
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

// List a lead's registrations (newest first), joined to the event catalog.
router.get('/:studentId', requireStaff, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT le.id, le.source_of_lead, le.source, le.source_detail, le.status, le.event_id,
              e.name AS event_name,
              to_char(e.start_date, 'YYYY-MM-DD') AS event_start,
              to_char(e.end_date,   'YYYY-MM-DD') AS event_end
         FROM lead_events le
         LEFT JOIN events e ON e.id = le.event_id
        WHERE le.student_id = $1
        ORDER BY le.created_at DESC, le.id DESC`,
      [req.params.studentId]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[leadEvents] list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load registrations' });
  }
});

// Update attendance status (the only editable field).
router.put('/:id/status', requireStaff, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid id' });
  const raw = (req.body.status ?? '').toString().trim();
  if (raw && !ALLOWED_STATUS.has(raw)) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }
  try {
    const upd = await pool.query(
      `UPDATE lead_events SET status = $1, updated_at = now() WHERE id = $2 RETURNING id`,
      [raw || null, id]
    );
    if (upd.rowCount === 0) return res.status(404).json({ success: false, error: 'Registration not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[leadEvents] status update failed:', err);
    res.status(500).json({ success: false, error: 'Failed to update status' });
  }
});

module.exports = router;

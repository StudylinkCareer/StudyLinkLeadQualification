// Server/src/controllers/eventPassController.js
// ─────────────────────────────────────────────────────────────────────
// On-site check-in flow (events.meta.checkinFlow = 'onsite'), customer side.
// Right after the basic registration the wizard asks for the student's event
// passes, renders each badge QR (same badgeRenderer as everywhere else) and
// posts it back here, and we send it straight away by e-mail AND Zalo.
//
//   GET  /students/:id/event-passes                 → on-site events + QR token
//   POST /students/:id/event-passes/:eventId/send   { badgePng } → e-mail + Zalo
//
// Both sit behind requireOwnStudent, so a session can only reach its own
// record. The send is idempotent: a channel that already went out is skipped.
// ─────────────────────────────────────────────────────────────────────

const { Pool } = require('pg');
const { issueAdvanceTokens, ONSITE_FLOW } = require('../services/eventQualification');
const { emailBadge, zaloBadge } = require('../services/eventBadgeDelivery');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const MAX_BADGE_BASE64 = 2 * 1024 * 1024;

// Current/upcoming on-site events the student is registered for, joined to
// their attendee row (token + what has been delivered).
async function loadPasses(studentId, eventId = null) {
  const r = await pool.query(
    `SELECT DISTINCT ON (e.id)
            e.id AS event_id, e.name, e.label_vi, e.label_en,
            ea.attendance_token, ea.badge_emailed_at, ea.badge_zalo_sent_at
       FROM lead_events le
       JOIN events e ON e.id = le.event_id
       LEFT JOIN event_attendees ea ON ea.event_id = e.id AND ea.student_unique_id = le.student_id
      WHERE le.student_id = $1
        AND e.meta->>'checkinFlow' = $2
        AND COALESCE(e.end_date, e.start_date) >= CURRENT_DATE
        AND ($3::int IS NULL OR e.id = $3)
      ORDER BY e.id`,
    [studentId, ONSITE_FLOW, eventId]
  );
  return r.rows;
}

const toPass = (row) => ({
  eventId: row.event_id,
  eventName: row.label_vi || row.name,
  eventNameEn: row.label_en || row.name,
  token: row.attendance_token,
  emailed: !!row.badge_emailed_at,
  zaloSent: !!row.badge_zalo_sent_at,
});

async function listEventPasses(req, res, next) {
  try {
    const { id } = req.params;
    // Mint any missing token first (on-site events don't wait for the gem).
    await issueAdvanceTokens(pool, id);
    const rows = await loadPasses(id);
    res.json({ success: true, data: rows.filter((r) => r.attendance_token).map(toPass) });
  } catch (err) { next(err); }
}

async function sendEventPass(req, res, next) {
  try {
    const { id } = req.params;
    const eventId = parseInt(req.params.eventId, 10);
    const badgePng = String(req.body.badgePng || '').trim();
    if (isNaN(eventId)) return res.status(400).json({ success: false, error: 'Invalid event id' });
    if (!badgePng) return res.status(400).json({ success: false, error: 'badgePng is required' });
    if (badgePng.length > MAX_BADGE_BASE64) return res.status(400).json({ success: false, error: 'Badge image too large' });

    const [pass] = await loadPasses(id, eventId);
    if (!pass || !pass.attendance_token) {
      return res.status(404).json({ success: false, error: 'No on-site event pass for this event' });
    }

    // The request comes from the wizard itself, so its Origin IS the LQ base URL
    // (used for the /profile?t= link in the e-mail).
    const baseUrl = req.get('origin') || '';
    const out = { emailed: !!pass.badge_emailed_at, zaloSent: !!pass.badge_zalo_sent_at, errors: {} };

    if (!out.emailed) {
      try {
        await emailBadge(pool, { eventId, studentId: id, badgePng, baseUrl });
        out.emailed = true;
      } catch (e) {
        console.error('[event-pass] email:', e.message);
        out.errors.email = e.message;
      }
    }
    if (!out.zaloSent) {
      try {
        const z = await zaloBadge(pool, { eventId, studentId: id, baseUrl });
        out.zaloSent = z.sent;
        if (!z.sent) out.errors.zalo = z.reason || 'not_sent';
      } catch (e) {
        console.error('[event-pass] zalo:', e.message);
        out.errors.zalo = e.message;
      }
    }
    res.json({ success: true, data: out });
  } catch (err) { next(err); }
}

module.exports = { listEventPasses, sendEventPass };

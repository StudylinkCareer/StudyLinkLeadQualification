// Server/src/services/eventBadgeDelivery.js
// ─────────────────────────────────────────────────────────────────────
// Event badge (QR) delivery by e-mail and Zalo. Shared by the Event Console's
// manual "Email badge" / "Zalo badge" buttons and the on-site flow's automatic
// send right after a student registers (POST /students/:id/event-passes/...).
// Every function stamps the event_attendees row it delivered for.
// ─────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { checkStudent } = require('./eventQualification');
const { sendEventQrEmail } = require('./emailService');
const { sendEventBadge } = require('./zaloService');
const { stoneContent } = require('../utils/stoneContent');

// Public URL of THIS API (e-mail clients fetch badge/stone images from here).
const publicBase = () => (process.env.PUBLIC_BASE_URL
  || 'https://studylinkleadqualification-production.up.railway.app').replace(/\/+$/, '');

class DeliveryError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// The LQ (Client) base URL → the public "Know you better" page for a token.
function profileUrlFor(baseUrl, token) {
  const lqBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(lqBase) ? `${lqBase}/profile?t=${encodeURIComponent(token)}` : '';
}

// Mint (or return the existing) attendance token for a registrant. Idempotent:
// an existing token is kept via COALESCE.
async function ensureAttendeeToken(pool, eventId, studentId) {
  const r = await pool.query(
    `INSERT INTO event_attendees
            (event_id, student_unique_id, registered_at, attendance_token)
          VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (event_id, student_unique_id) DO UPDATE
          SET attendance_token = COALESCE(event_attendees.attendance_token, EXCLUDED.attendance_token),
              updated_at       = NOW()
     RETURNING attendance_token`,
    [eventId, studentId, crypto.randomUUID()]
  );
  return r.rows[0].attendance_token;
}

// E-mail the rendered badge PNG (base64, no data: prefix). Resolves the real
// (unmasked) e-mail from the students row unless `email` overrides it.
// Returns { badge_emailed_at, badge_emailed_to }; throws DeliveryError (4xx).
async function emailBadge(pool, { eventId, studentId, badgePng, email = '', baseUrl = '', badgeUrl = '' }) {
  const attToken = await ensureAttendeeToken(pool, eventId, studentId);

  // Real (unmasked) name + email straight from the students row. The full row
  // rides along: stone_tier drives the stone banner, and the qualification
  // gate (checkStudent) decides which questionnaire copy the e-mail shows
  // ("please complete" vs "review/update your answers").
  const sres = await pool.query(`SELECT * FROM students WHERE student_id = $1 LIMIT 1`, [studentId]);
  if (sres.rowCount === 0) throw new DeliveryError(404, 'Student not found');
  const studentName = sres.rows[0].full_name || '';
  const recipient   = String(email || '').trim() || String(sres.rows[0].email || '').trim();
  if (!recipient) throw new DeliveryError(400, 'No email address on file; provide one to send to');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    throw new DeliveryError(400, 'That email address looks invalid - please check it.');
  }

  const ev = await pool.query(`SELECT name FROM events WHERE id = $1 LIMIT 1`, [eventId]);
  const eventName = ev.rowCount ? (ev.rows[0].name || '') : '';

  // Hosted badge URL only on PROD (?v busts mail-proxy caches when the badge
  // is later re-rendered with the stone). On dev the URL would point at PROD
  // with a dev-only token, so we send no URL — the GAS relay then falls back
  // to attaching the PNG inline, keeping dev e-mails testable.
  const PUBLIC_BASE = publicBase();
  const badgeImageUrl = process.env.NODE_ENV === 'production'
    ? `${PUBLIC_BASE}/api/event-console/badge-image/${attToken}?v=${Date.now()}`
    : '';

  // Stone banner content (null when unscored -> e-mail renders as before).
  const stone = stoneContent(sres.rows[0].stone_tier, 'vi', PUBLIC_BASE);

  // Has the student answered every required questionnaire field?
  let questionnaireComplete = false;
  try { questionnaireComplete = (await checkStudent(pool, sres.rows[0])).qualified; } catch (_) {}

  // Store the rendered badge BEFORE sending: the e-mail shows it via the
  // public /badge-image/:token URL (no attachment -> mail clients can't
  // render a duplicate thumbnail of it at the end of the message).
  await pool.query(
    `UPDATE event_attendees
        SET badge_png = $3, updated_at = NOW()
      WHERE event_id = $1 AND student_unique_id = $2`,
    [eventId, studentId, badgePng]
  );

  await sendEventQrEmail(recipient, {
    name: studentName,
    eventName,
    badgeUrl,
    badgeImageUrl,
    badgePngBase64: badgePng,   // legacy fallback while the old GAS template is live
    profileUrl: profileUrlFor(baseUrl, attToken),
    stone,
    questionnaireComplete,
  });

  const upd = await pool.query(
    `UPDATE event_attendees
        SET badge_emailed_at = NOW(), badge_emailed_to = $3, updated_at = NOW()
      WHERE event_id = $1 AND student_unique_id = $2
      RETURNING badge_emailed_at, badge_emailed_to`,
    [eventId, studentId, recipient]
  );
  return upd.rows[0] || { badge_emailed_to: recipient };
}

// Send the badge over Zalo (ZNS by phone, or OA message by user_id). No PNG
// needed: the message links to /profile?t=<token>, which renders the QR itself.
// Returns { sent: true, data } or { sent: false, reason, detail }; throws
// DeliveryError(404) when the student is gone.
async function zaloBadge(pool, { eventId, studentId, baseUrl = '', method }) {
  const attToken = await ensureAttendeeToken(pool, eventId, studentId);

  const sres = await pool.query(`SELECT full_name, phone FROM students WHERE student_id = $1 LIMIT 1`, [studentId]);
  if (sres.rowCount === 0) throw new DeliveryError(404, 'Student not found');
  const studentName = sres.rows[0].full_name || '';
  const phone       = String(sres.rows[0].phone || '').trim();

  const ev = await pool.query(`SELECT name FROM events WHERE id = $1 LIMIT 1`, [eventId]);
  const eventName = ev.rowCount ? (ev.rows[0].name || '') : '';

  const result = await sendEventBadge({
    method,
    phone,
    name: studentName,
    eventName,
    profileUrl: profileUrlFor(baseUrl, attToken),   // used by the OA free-form path
    registrationCode: studentId,                     // ZNS "Mã đăng ký" (Sales ID)
    token: attToken,                                 // ZNS button URL: /profile?t=<token>
  });

  if (!result.sent) {
    console.warn('[badge-delivery] zalo NOT SENT:', JSON.stringify({ reason: result.reason, detail: result.detail, raw: result.raw }));
    const why = result.detail || result.reason || 'error';
    await pool.query(
      `UPDATE event_attendees
          SET badge_zalo_status = 'failed', badge_zalo_error = $3, updated_at = NOW()
        WHERE event_id = $1 AND student_unique_id = $2`,
      [eventId, studentId, why]
    ).catch((e) => console.error('[badge-delivery] zalo status(fail) write:', e.message));
    return { sent: false, reason: result.reason, detail: result.detail };
  }

  // Zalo accepted it. Capture the message id so the delivery webhook/poller
  // can match the "user received" event back to this attendee.
  const msgId = (result.raw && result.raw.data && (result.raw.data.msg_id || result.raw.data.message_id)) || null;
  const upd = await pool.query(
    `UPDATE event_attendees
        SET badge_zalo_sent_at      = NOW(),
            badge_zalo_status       = 'accepted',
            badge_zalo_msg_id       = $3,
            badge_zalo_error        = NULL,
            badge_zalo_delivered_at = NULL,
            updated_at              = NOW()
      WHERE event_id = $1 AND student_unique_id = $2
      RETURNING badge_zalo_sent_at, badge_zalo_msg_id`,
    [eventId, studentId, msgId]
  );
  console.log('[badge-delivery] zalo SENT:', JSON.stringify({ to: result.to, msgId }));
  return {
    sent: true,
    data: upd.rows[0] || { badge_zalo_sent_at: new Date().toISOString(), badge_zalo_msg_id: msgId },
  };
}

module.exports = { DeliveryError, ensureAttendeeToken, emailBadge, zaloBadge };

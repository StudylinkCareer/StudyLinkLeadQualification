// Server/src/routes/zaloWebhook.js
// ---------------------------------------------------------------------------
// Phase 2 of reliable Zalo badge delivery: TRUE delivery confirmation.
//
// Zalo calls this webhook when a ZNS message is delivered to the user's
// device (event_name "user_received_message", payload carries msg_id,
// delivery_time (ms epoch), tracking_id and the recipient phone). We match
// msg_id against event_attendees.badge_zalo_msg_id (stored by Phase 1 at
// send time) and flip that attendee to badge_zalo_status='delivered', which
// lights the green "Zalo ✓ delivered" chip in the Event Console roster.
//
// Setup (one-time, in developers.zalo.me → app "QR Event Registration Badge"
// 943526229180574542 → Webhook): set the Webhook URL to
//   https://<railway-app-domain>/api/zalo/webhook
// and subscribe to the ZNS delivery event.
//
// Design notes:
//   - UNAUTHENTICATED by necessity (Zalo is the caller). The handler is
//     deliberately harmless: it can only flip a status flag on rows whose
//     stored msg_id matches — unknown ids are ignored. Always answers 200
//     quickly (Zalo retries/disables webhooks that error or time out).
//   - Fallback match: our sends stamp tracking_id "badge_<studentId>_<ts>",
//     so if a Zalo payload variant omits/renames msg_id we can still resolve
//     the attendee from tracking_id.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Zalo may probe the URL (GET) when the webhook is saved in the app console.
router.get('/webhook', (_req, res) => res.status(200).send('OK'));

router.post('/webhook', async (req, res) => {
  // Acknowledge immediately no matter what — never make Zalo retry because
  // our DB hiccuped; we log anything we couldn't apply.
  res.status(200).json({ success: true });

  try {
    const b = req.body || {};
    const eventName = String(b.event_name || '');

    // ZNS device-delivery event. msg_id location differs between payload
    // variants (top-level for ZNS, under message{} for OA events) — take both.
    if (eventName === 'user_received_message') {
      const msgId = String(b.msg_id || (b.message && b.message.msg_id) || '').trim();
      const trackingId = String(b.tracking_id || '').trim();
      const deliveryMs = parseInt(b.delivery_time || b.timestamp, 10);
      const deliveredAt = Number.isFinite(deliveryMs) && deliveryMs > 0
        ? new Date(deliveryMs) : new Date();

      let updated = 0;
      if (msgId) {
        const r = await pool.query(
          `UPDATE event_attendees
              SET badge_zalo_status = 'delivered', badge_zalo_delivered_at = $2, updated_at = NOW()
            WHERE badge_zalo_msg_id = $1 AND badge_zalo_delivered_at IS NULL`,
          [msgId, deliveredAt]
        );
        updated = r.rowCount;
      }

      // Fallback: resolve the attendee from our tracking_id ("badge_<studentId>_<ts>").
      if (!updated && trackingId.startsWith('badge_')) {
        const studentId = trackingId.split('_')[1] || '';
        if (studentId) {
          const r = await pool.query(
            `UPDATE event_attendees
                SET badge_zalo_status = 'delivered', badge_zalo_delivered_at = $2, updated_at = NOW()
              WHERE student_unique_id = $1 AND badge_zalo_status = 'accepted'
                AND badge_zalo_delivered_at IS NULL`,
            [studentId, deliveredAt]
          );
          updated = r.rowCount;
        }
      }

      console.log('[zalo-webhook] user_received_message:',
        JSON.stringify({ msgId, trackingId, updated }));
      return;
    }

    // Everything else: one debug line so we can see what Zalo sends us.
    console.log('[zalo-webhook] event ignored:', eventName || '(no event_name)');
  } catch (err) {
    console.error('[zalo-webhook] handler error:', err.message);
  }
});

module.exports = router;

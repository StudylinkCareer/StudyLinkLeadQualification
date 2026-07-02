// Server/src/services/zaloDeliveryPoller.js
// ---------------------------------------------------------------------------
// Phase 2 (PULL model). Zalo won't POST ZNS delivery events to our US-IP
// webhook (geo-filtered), so instead of being pushed we PULL: every couple of
// minutes we query the ZNS message-status API for badges that are 'accepted'
// but not yet 'delivered', and flip the delivered ones. The roster already
// renders 'delivered' as the green "Zalo ✓ delivered" chip, so no UI change is
// needed — staff see it on the next refresh.
//
// Delivered signal (confirmed empirically via scripts/zaloMsgStatus.js):
//   data.status === 1  +  message "The message was delivered to the user's phone"
//   data.delivery_time = delivery timestamp (ms epoch)
// ---------------------------------------------------------------------------

const { Pool } = require('pg');
const { getZnsMessageStatus } = require('./zaloService');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

function deliveredAtFrom(raw) {
  const ms = parseInt(raw && raw.data && raw.data.delivery_time, 10);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : new Date();
}

// Classify a ZNS status response into delivered / failed / pending.
//   delivered: status === 1 (or a "delivered" message)  [status:1 confirmed empirically]
//   failed:    a TERMINAL failure — not a Zalo user / invalid number / expired / rejected.
//              Conservative keyword match; anything unmatched-and-not-delivered stays
//              'pending' and is logged so we can tighten this list from real responses.
//   pending:   still on its way — keep polling.
function classify(raw) {
  const d = (raw && raw.data) || {};
  const msg = String(d.message || '');
  if (d.status === 1 || /deliver/i.test(msg)) {
    return { state: 'delivered', at: deliveredAtFrom(raw) };
  }
  if (/reject|not\s*using|invalid|expired|undeliver|not\s*receiv|fail/i.test(msg)) {
    return { state: 'failed', reason: msg || 'Zalo could not deliver (bad number?)' };
  }
  return { state: 'pending' };
}

let running = false;

async function pollOnce({ verbose = false } = {}) {
  if (running) return { skipped: true };
  running = true;
  const summary = { checked: 0, delivered: 0, failed: 0, errors: 0 };
  try {
    const pend = await pool.query(
      `SELECT event_id, student_unique_id, badge_zalo_msg_id
         FROM event_attendees
        WHERE badge_zalo_status = 'accepted'
          AND badge_zalo_msg_id IS NOT NULL
          AND badge_zalo_sent_at > NOW() - INTERVAL '2 days'
        ORDER BY badge_zalo_sent_at DESC
        LIMIT 50`
    );
    for (const row of pend.rows) {
      summary.checked++;
      const raw = await getZnsMessageStatus(row.badge_zalo_msg_id);
      if (!raw || raw.error !== 0) { summary.errors++; continue; }
      const c = classify(raw);
      // Log anything that isn't a clean 'delivered' so we can learn Zalo's exact
      // failure / pending wording and tighten classify() from real responses.
      if (verbose || c.state !== 'delivered') {
        console.log('[zalo-poll]', row.badge_zalo_msg_id, c.state, '=>', JSON.stringify(raw));
      }
      if (c.state === 'delivered') {
        const r = await pool.query(
          `UPDATE event_attendees
              SET badge_zalo_status = 'delivered', badge_zalo_delivered_at = $3, updated_at = NOW()
            WHERE event_id = $1 AND student_unique_id = $2 AND badge_zalo_status = 'accepted'`,
          [row.event_id, row.student_unique_id, c.at]
        );
        if (r.rowCount) summary.delivered++;
      } else if (c.state === 'failed') {
        const r = await pool.query(
          `UPDATE event_attendees
              SET badge_zalo_status = 'failed', badge_zalo_error = $3, updated_at = NOW()
            WHERE event_id = $1 AND student_unique_id = $2 AND badge_zalo_status = 'accepted'`,
          [row.event_id, row.student_unique_id, c.reason]
        );
        if (r.rowCount) summary.failed++;
      }
    }
    if (summary.checked) console.log('[zalo-poll] cycle:', JSON.stringify(summary));
  } catch (err) {
    console.error('[zalo-poll] error:', err.message);
  } finally {
    running = false;
  }
  return summary;
}

function start(intervalMs = 2 * 60 * 1000) {
  console.log('[zalo-poll] delivery poller started; interval', Math.round(intervalMs / 1000), 's');
  // One cycle shortly after boot, then on the interval.
  setTimeout(() => pollOnce().catch(() => {}), 20 * 1000);
  setInterval(() => pollOnce().catch(() => {}), intervalMs);
}

module.exports = { pollOnce, start };

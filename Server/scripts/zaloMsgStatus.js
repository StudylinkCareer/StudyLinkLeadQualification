// Server/scripts/zaloMsgStatus.js
// ---------------------------------------------------------------------------
// Probe the ZNS delivery-status PULL API before wiring the delivery poller.
// Zalo won't push delivery events to our US-IP webhook, so we pull status by
// message id instead. This prints the RAW Zalo response so we can see the exact
// field names + status codes and build the poller correctly (no guessing).
//
// The OA token lives in the PROD database, so run this against PROD:
//   $env:DATABASE_URL="<prod railway url>"; $env:NODE_ENV="production"
//   node scripts/zaloMsgStatus.js 0d53c0c0c4cd6b9432db
// ---------------------------------------------------------------------------

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const tm = require('../src/services/zaloTokenManager');

(async () => {
  const msgId = (process.argv[2] || '').trim();
  if (!msgId) {
    console.error('Usage: node scripts/zaloMsgStatus.js <msg_id>');
    process.exit(1);
  }

  const token = await tm.getAccessToken();
  if (!token) { console.error('No OA access token available.'); process.exit(1); }

  const url = `https://business.openapi.zalo.me/message/status?message_id=${encodeURIComponent(msgId)}`;
  console.log('GET', url, '\n');

  const res = await fetch(url, { headers: { access_token: token } });
  const data = await res.json().catch(() => ({}));
  console.log('HTTP', res.status);
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });

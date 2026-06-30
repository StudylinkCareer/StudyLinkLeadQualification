// Server/scripts/zaloOaInfo.js
// ---------------------------------------------------------------------------
// Quick health check: calls the OA "get info" API with ZALO_OA_ACCESS_TOKEN
// from Server/.env and prints the OA name/id. If this returns the OA's name,
// the access token + granted permissions are working end-to-end.
//   node scripts/zaloOaInfo.js
// ---------------------------------------------------------------------------

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const token = (process.env.ZALO_OA_ACCESS_TOKEN || '').trim();
if (!token) {
  console.error('✗ ZALO_OA_ACCESS_TOKEN is not set in Server/.env');
  process.exit(1);
}

(async () => {
  try {
    const res = await fetch('https://openapi.zalo.me/v2.0/oa/getoa', {
      method: 'GET',
      headers: { access_token: token },
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.error === 0) {
      console.log('\n✓ Token works. OA:', data.data && (data.data.name || data.data.oa_id));
      console.log(JSON.stringify(data.data, null, 2));
    } else {
      console.error('✗ OA info call failed:', JSON.stringify(data));
      process.exit(1);
    }
  } catch (err) {
    console.error('✗ Network error:', err.message);
    process.exit(1);
  }
})();

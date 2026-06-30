// Server/scripts/zaloTokenCheck.js
// ---------------------------------------------------------------------------
// Exercises the token manager end-to-end: getAccessToken() (refreshes +
// persists if needed), then calls the OA get-info API with that token.
// Proves auto-refresh works and the resulting token is valid.
//   node scripts/zaloTokenCheck.js
// (Run createZaloTokens.js migration first.)
// ---------------------------------------------------------------------------

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const tm = require('../src/services/zaloTokenManager');

(async () => {
  const token = await tm.getAccessToken();
  console.log('✓ token manager returned a token (length ' + token.length + ')');
  const res = await fetch('https://openapi.zalo.me/v2.0/oa/getoa', { headers: { access_token: token } });
  const data = await res.json().catch(() => ({}));
  if (data && data.error === 0) {
    console.log('✓ token is valid — OA:', data.data && data.data.name);
    process.exit(0);
  }
  console.error('✗ token call failed:', JSON.stringify(data));
  process.exit(1);
})().catch(e => { console.error('✗', e.message); process.exit(1); });

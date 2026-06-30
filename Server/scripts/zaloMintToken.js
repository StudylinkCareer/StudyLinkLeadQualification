// Server/scripts/zaloMintToken.js
// ---------------------------------------------------------------------------
// Mint or refresh a Zalo Official Account (OA) access token.
//
//   1) Initial mint (after the OAuth consent redirect gives you a ?code=...):
//        node scripts/zaloMintToken.js <auth_code>
//
//   2) Refresh an existing token (refresh_token rotates each time — save the NEW one):
//        node scripts/zaloMintToken.js --refresh <refresh_token>
//
// Reads ZALO_APP_ID + ZALO_APP_SECRET from Server/.env. Prints access_token,
// refresh_token, and expiry. Access tokens last ~1h; refresh tokens ~3 months
// and ROTATE on every refresh, so always persist the new refresh_token.
// ---------------------------------------------------------------------------

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const APP_ID  = (process.env.ZALO_APP_ID || '').trim();
const SECRET  = (process.env.ZALO_APP_SECRET || '').trim();
const TOKEN_URL = 'https://oauth.zaloapp.com/v4/oa/access_token';

if (!APP_ID || !SECRET) {
  console.error('✗ Set ZALO_APP_ID and ZALO_APP_SECRET in Server/.env first.');
  process.exit(1);
}

const args = process.argv.slice(2);
const isRefresh = args[0] === '--refresh';
const value = isRefresh ? args[1] : args[0];

if (!value) {
  console.error('Usage:\n  node scripts/zaloMintToken.js <auth_code>\n  node scripts/zaloMintToken.js --refresh <refresh_token>');
  process.exit(1);
}

// Zalo v4 OA token endpoint: x-www-form-urlencoded body + secret_key header.
const body = new URLSearchParams(
  isRefresh
    ? { refresh_token: value, app_id: APP_ID, grant_type: 'refresh_token' }
    : { code: value, app_id: APP_ID, grant_type: 'authorization_code' }
);

(async () => {
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        secret_key: SECRET,
      },
      body: body.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.access_token) {
      console.error('✗ Token request failed:', JSON.stringify(data));
      process.exit(1);
    }
    console.log('\n✓ Token minted:\n');
    console.log('  access_token  :', data.access_token);
    console.log('  refresh_token :', data.refresh_token, '  ← SAVE THIS (it rotates)');
    console.log('  expires_in    :', data.expires_in, 'sec (~' + Math.round((+data.expires_in || 0) / 3600) + 'h)');
    console.log('\nPut into Server/.env:');
    console.log('  ZALO_OA_ACCESS_TOKEN=' + data.access_token);
    console.log('  ZALO_OA_REFRESH_TOKEN=' + data.refresh_token);
  } catch (err) {
    console.error('✗ Network error:', err.message);
    process.exit(1);
  }
})();

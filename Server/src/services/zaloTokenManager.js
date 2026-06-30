// Server/src/services/zaloTokenManager.js
// ---------------------------------------------------------------------------
// Keeps a valid Zalo OA access token available. OA access tokens last ~25h and
// the refresh token ROTATES on every refresh, so we persist both in the
// zalo_oauth_tokens table (Railway fs is ephemeral). getAccessToken():
//   - returns the stored access token if it's still comfortably valid
//   - otherwise refreshes via the refresh token, persists the NEW rotated
//     refresh token + new access token, and returns the fresh access token
//   - bootstraps from ZALO_OA_REFRESH_TOKEN (.env) on first run
// Single-flight: concurrent callers share one in-progress refresh.
// ---------------------------------------------------------------------------

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const TOKEN_URL = 'https://oauth.zaloapp.com/v4/oa/access_token';
const EARLY_REFRESH_MS = 10 * 60 * 1000; // refresh 10 min before expiry
let inFlight = null;

async function loadRow() {
  const r = await pool.query(
    `SELECT access_token, refresh_token, expires_at FROM zalo_oauth_tokens WHERE id = 1`
  );
  return r.rows[0] || null;
}

async function saveRow({ access_token, refresh_token, expires_at }) {
  await pool.query(
    `INSERT INTO zalo_oauth_tokens (id, access_token, refresh_token, expires_at, updated_at)
     VALUES (1, $1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE
       SET access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           expires_at = EXCLUDED.expires_at,
           updated_at = now()`,
    [access_token, refresh_token, expires_at]
  );
}

async function doRefresh(refreshToken) {
  const appId  = (process.env.ZALO_APP_ID || '').trim();
  const secret = (process.env.ZALO_APP_SECRET || '').trim();
  if (!appId || !secret) throw new Error('ZALO_APP_ID / ZALO_APP_SECRET not set');

  const body = new URLSearchParams({
    refresh_token: refreshToken, app_id: appId, grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: secret },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) throw new Error('Zalo token refresh failed: ' + JSON.stringify(data));

  const row = {
    access_token:  data.access_token,
    refresh_token: data.refresh_token || refreshToken, // rotates — keep the new one
    expires_at:    new Date(Date.now() + (Number(data.expires_in || 0) * 1000)),
  };
  await saveRow(row);
  return row;
}

// Returns a currently-valid OA access token, refreshing if needed.
async function getAccessToken() {
  let row = await loadRow();

  // Bootstrap from .env on first run (table empty).
  if (!row || !row.refresh_token) {
    const envRefresh = (process.env.ZALO_OA_REFRESH_TOKEN || '').trim();
    if (!envRefresh) throw new Error('No Zalo refresh token: set ZALO_OA_REFRESH_TOKEN in .env');
    // Force an immediate refresh so we hold a known-fresh access token + the
    // current rotated refresh token in the DB (don't trust the env access token's
    // unknown remaining life).
    row = { access_token: null, refresh_token: envRefresh, expires_at: null };
  }

  const expMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (row.access_token && expMs - Date.now() > EARLY_REFRESH_MS) {
    return row.access_token; // still comfortably valid
  }

  // Refresh (single-flight so concurrent sends don't double-refresh).
  if (!inFlight) {
    inFlight = doRefresh(row.refresh_token).finally(() => { inFlight = null; });
  }
  const fresh = await inFlight;
  return fresh.access_token;
}

module.exports = { getAccessToken, _loadRow: loadRow };

// Server/src/migrations/createZaloTokens.js
// ---------------------------------------------------------------------------
// Single-row store for the Zalo OA OAuth tokens, so the access token can be
// auto-refreshed and the ROTATING refresh token persisted across restarts
// (Railway's filesystem is ephemeral, so this must live in the DB).
// Idempotent. Run on dev now; --allow-remote at PROD cutover.
// ---------------------------------------------------------------------------

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const url = process.env.DATABASE_URL || '';
if (!process.argv.includes('--allow-remote') && !(url.includes('localhost') && url.includes('studylink_dev'))) {
  console.error('✗ Refusing to run: DATABASE_URL is not localhost/studylink_dev. Use --allow-remote for PROD.');
  process.exit(1);
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS zalo_oauth_tokens (
        id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        access_token  text,
        refresh_token text,
        expires_at    timestamptz,
        updated_at    timestamptz DEFAULT now()
      )
    `);
    console.log('✓ zalo_oauth_tokens table ready\n');
  } catch (err) {
    console.error('✗ Failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });

// POSM QR tracking (2026-10, Hoàng / owner): printed materials (umbrellas,
// fans, helmets...) each get a permanent short QR link. Kept apart from
// events on purpose — a POSM item is not an event registration.
//   - posm_items:   one row per printed item; `code` is the short link
//                   (/q/<code>) printed in the QR, so it never changes.
//   - posm_scans:   one row per QR open (count only, no personal data).
//   - posm_signups: a sign-up that came from a POSM QR, plus the optional
//                   "where did you receive it" answer (an event, or other).
//                   Source of Lead stays the guest's own answer.
//
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addPosm.js
//   PROD: node src/migrations/addPosm.js --allow-remote
require('dotenv').config();
const { Pool } = require('pg');

const url  = process.env.DATABASE_URL || '';
const host = (url.split('@')[1] || '').split('/')[0] || '(unknown)';
const isLocal     = /localhost|127\.0\.0\.1|studylink_dev/.test(url);
const allowRemote = process.argv.includes('--allow-remote');

if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!isLocal && !allowRemote) {
  console.error(`Refusing to run against non-local DB (${host}) without --allow-remote`);
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

(async () => {
  console.log(`addPosm -> ${host}`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS posm_items (
        id          SERIAL PRIMARY KEY,
        code        TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        notes       TEXT,
        is_active   BOOLEAN NOT NULL DEFAULT true,
        created_by  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS posm_scans (
        id          BIGSERIAL PRIMARY KEY,
        posm_id     INTEGER NOT NULL REFERENCES posm_items(id) ON DELETE CASCADE,
        scanned_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS posm_scans_posm_time ON posm_scans (posm_id, scanned_at)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS posm_signups (
        id                 SERIAL PRIMARY KEY,
        student_id         TEXT NOT NULL,
        posm_id            INTEGER NOT NULL REFERENCES posm_items(id) ON DELETE CASCADE,
        received_event_id  INTEGER REFERENCES events(id) ON DELETE SET NULL,
        received_other     BOOLEAN NOT NULL DEFAULT false,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (student_id, posm_id)
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS posm_signups_posm_time ON posm_signups (posm_id, created_at)`);
    await client.query('COMMIT');
    const n = await client.query(`SELECT (SELECT count(*) FROM posm_items) items, (SELECT count(*) FROM posm_scans) scans, (SELECT count(*) FROM posm_signups) signups`);
    console.log('done:', n.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('FAILED, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();

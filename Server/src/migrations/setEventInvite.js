// Server/src/migrations/setEventInvite.js
// ---------------------------------------------------------------------------
// Author the meeting-invite details (time / venue / info link) for one event.
// Stored in events.meta.invite; the public profile page (badge landing view)
// renders them under the QR badge, so Zalo/e-mail recipients see the invite
// one tap away. Re-run any time to update; reusable for every future event.
//
//   node src/migrations/setEventInvite.js --event 36 ^
//        --time "14:00 – 17:30 | Thứ Bảy, 18/07/2026" ^
//        --venue "Nhà khách Quốc Hội, 165 Nam Kỳ Khởi Nghĩa, Q.3, TP.HCM" ^
//        --url "https://www.facebook.com/share/p/1NwkSnZFbe/"
//   Add --allow-remote for a deliberate PROD run. Use --clear to remove.
// ---------------------------------------------------------------------------
require('dotenv').config();
const { Pool } = require('pg');

const ARGS = process.argv.slice(2);
const ALLOW_REMOTE = ARGS.includes('--allow-remote');
const CLEAR = ARGS.includes('--clear');
const arg = (name) => {
  const i = ARGS.indexOf(`--${name}`);
  return i >= 0 && ARGS[i + 1] && !ARGS[i + 1].startsWith('--') ? ARGS[i + 1] : '';
};

const eventId = parseInt(arg('event'), 10);
if (isNaN(eventId)) {
  console.error('Usage: node src/migrations/setEventInvite.js --event <id> --time "..." --venue "..." [--url "..."] [--clear] [--allow-remote]');
  process.exit(1);
}

const url = process.env.DATABASE_URL || '';
const host = (url.match(/@([^:@/]+)/) || [])[1] || '(?)';
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
if (!isLocal && !ALLOW_REMOTE) {
  console.error(`ABORT: non-local host "${host}". Use --allow-remote for a deliberate PROD run.`);
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

(async () => {
  try {
    let q, params;
    if (CLEAR) {
      q = `UPDATE events SET meta = COALESCE(meta, '{}'::jsonb) - 'invite' WHERE id = $1 RETURNING name, meta`;
      params = [eventId];
    } else {
      const invite = {};
      if (arg('time'))  invite.time  = arg('time');
      if (arg('venue')) invite.venue = arg('venue');
      if (arg('url'))   invite.infoUrl = arg('url');
      if (Object.keys(invite).length === 0) {
        console.error('Nothing to set: provide at least one of --time / --venue / --url (or --clear).');
        process.exit(1);
      }
      q = `UPDATE events SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('invite', $2::jsonb) WHERE id = $1 RETURNING name, meta`;
      params = [eventId, JSON.stringify(invite)];
    }
    const r = await pool.query(q, params);
    if (r.rowCount === 0) {
      console.error(`✗ No event with id ${eventId}`);
      process.exitCode = 1;
    } else {
      console.log(`✓ "${r.rows[0].name}" meta.invite =`, JSON.stringify(r.rows[0].meta.invite || null));
      console.log(`✓ COMMITTED on ${host}`);
    }
  } catch (e) {
    console.error('✗ failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

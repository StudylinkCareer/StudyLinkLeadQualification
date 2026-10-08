// Server/src/migrations/setEventCheckinFlow.js
// ---------------------------------------------------------------------------
// Choose an event's check-in flow (events.meta.checkinFlow):
//   classic — the Fair First Date 18.7.2026 flow (default for every event):
//             QR once the gem questionnaire is complete, reception check-in,
//             booths only take notes for students who already have a gem.
//   onsite  — for venues that only allow collecting data AT the event:
//             QR sent by e-mail + Zalo right after the basic registration,
//             booth staff complete the gem questions after scanning, the first
//             booth scan marks attendance, notes allowed with or without a gem.
// See checkinFlowOf() in services/eventQualification.js.
//
//   node src/migrations/setEventCheckinFlow.js --event 42 --flow onsite
//   node src/migrations/setEventCheckinFlow.js --event 42 --flow classic
//   Add --allow-remote for a deliberate PROD run.
// ---------------------------------------------------------------------------
require('dotenv').config();
const { Pool } = require('pg');

const ARGS = process.argv.slice(2);
const ALLOW_REMOTE = ARGS.includes('--allow-remote');
const arg = (name) => {
  const i = ARGS.indexOf(`--${name}`);
  return i >= 0 && ARGS[i + 1] && !ARGS[i + 1].startsWith('--') ? ARGS[i + 1] : '';
};

const eventId = parseInt(arg('event'), 10);
const flow = arg('flow');
if (isNaN(eventId) || !['onsite', 'classic'].includes(flow)) {
  console.error('Usage: node src/migrations/setEventCheckinFlow.js --event <id> --flow onsite|classic [--allow-remote]');
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
    // 'classic' is the default, so it is stored as the key's absence.
    const q = flow === 'classic'
      ? `UPDATE events SET meta = COALESCE(meta, '{}'::jsonb) - 'checkinFlow' WHERE id = $1 RETURNING name, event_type, meta`
      : `UPDATE events SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('checkinFlow', $2::text) WHERE id = $1 RETURNING name, event_type, meta`;
    const r = await pool.query(q, flow === 'classic' ? [eventId] : [eventId, flow]);
    if (r.rowCount === 0) {
      console.error(`✗ No event with id ${eventId}`);
      process.exitCode = 1;
      return;
    }
    const ev = r.rows[0];
    console.log(`✓ "${ev.name}" check-in flow = ${(ev.meta && ev.meta.checkinFlow) || 'classic'}`);
    if (ev.event_type !== 'Exhibition / Fair') {
      console.warn(`! event_type is "${ev.event_type}" — QR passes are only issued for 'Exhibition / Fair' events.`);
    }
    console.log(`✓ COMMITTED on ${host}`);
  } catch (e) {
    console.error('✗ failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

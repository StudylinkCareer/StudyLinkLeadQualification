// Server/src/services/weeklySnapshotScheduler.js
// ---------------------------------------------------------------------------
// Freezes the Weekly Report every Monday 08:00 Asia/Ho_Chi_Minh: computes the
// just-closed week's snapshot and stores it in weekly_report_snapshots. The
// /weekly endpoint then serves the stored (static) snapshot.
//
// In-process (mirrors the Zalo delivery poller). Includes a startup catch-up so
// a restart over the weekend never skips a week.
// ---------------------------------------------------------------------------

const { Pool } = require('pg');
const { generateWeeklySnapshot, vnWeekStart, lockRecommendationsBefore } = require('../controllers/reportController');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const VN_MS  = 7 * 60 * 60 * 1000;
const WEEK_MS = 7 * 86400000;
const vnYmd = (dt) => new Date(dt.getTime() + VN_MS).toISOString().slice(0, 10);

// Next Monday 08:00 VN strictly after `fromMs` (as a UTC instant).
function nextMonday8amVN(fromMs) {
  const vn = new Date(fromMs + VN_MS);
  const off = (vn.getUTCDay() + 6) % 7;                                 // Mon=0
  let target = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() - off, 8) - VN_MS;
  if (target <= fromMs) target += WEEK_MS;
  return target;
}

async function publishPriorWeek() {
  const wk = await generateWeeklySnapshot(vnWeekStart(Date.now(), 1));
  console.log('[weekly-snapshot] published week', wk);
  // Freeze recommendation notes for everything BEFORE the week just published —
  // its own notes stay open for supplemental additions until the next publish.
  await lockRecommendationsBefore(wk);
}

// If the just-closed week has no snapshot and we're already past its Monday
// 08:00 publish time (e.g. the server restarted over the weekend), publish now.
async function catchUp() {
  const ws = vnWeekStart(Date.now(), 1);
  const has = (await pool.query('SELECT 1 FROM weekly_report_snapshots WHERE week_start = $1', [vnYmd(ws)])).rowCount > 0;
  const publishMs = ws.getTime() + WEEK_MS + 8 * 60 * 60 * 1000;
  if (!has && Date.now() >= publishMs) {
    console.log('[weekly-snapshot] catch-up: missing snapshot for', vnYmd(ws));
    await publishPriorWeek();
  }
}

function scheduleNext() {
  const delay = nextMonday8amVN(Date.now()) - Date.now();
  setTimeout(async () => {
    try { await publishPriorWeek(); } catch (e) { console.error('[weekly-snapshot] publish failed:', e.message); }
    scheduleNext();
  }, delay);
  console.log('[weekly-snapshot] next run in ~' + Math.round(delay / 3600000) + 'h');
}

function start() {
  catchUp().catch(e => console.error('[weekly-snapshot] catch-up failed:', e.message));
  scheduleNext();
}

module.exports = { start };

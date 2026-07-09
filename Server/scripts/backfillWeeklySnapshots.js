// Server/scripts/backfillWeeklySnapshots.js
// ---------------------------------------------------------------------------
// One-off backfill of frozen Weekly Report snapshots for past weeks, so history
// is browsable as published reports (existing per-week Recommendations show
// automatically — they load live by week, not from the snapshot).
//
//   node scripts/backfillWeeklySnapshots.js [startMondayYMD]
//     default start = 2026-05-04 (first Monday of May); runs weekly up to and
//     including the last completed week.
//
// NOTE: uses the CURRENT active staff roster for every week (point-in-time
// membership still reconstructs correctly; only the set of names/groups is
// "as now"). Fine for recent months where the roster is stable.
// ---------------------------------------------------------------------------

require('dotenv').config();
const rc = require('../src/controllers/reportController');
const { Pool } = require('pg');

const url = process.env.DATABASE_URL || '';
if (!process.argv.includes('--allow-remote') && !(url.includes('localhost') && url.includes('studylink_dev'))) {
  console.error('✗ Refusing to run: DATABASE_URL is not localhost/studylink_dev. Use --allow-remote for a deliberate PROD run.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: url,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const VN_MS = 7 * 60 * 60 * 1000;
const startArg = (process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a))) || '2026-05-04';
function vnMonday(ymd) { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d) - VN_MS); }

(async () => {
  const lastMon = rc.vnWeekStart(Date.now(), 1);       // last completed week's Monday
  let cur = vnMonday(startArg);
  const done = [];
  console.log(`Backfilling weekly snapshots from ${startArg} up to the last completed week…`);
  while (cur.getTime() <= lastMon.getTime()) {
    const wk = await rc.generateWeeklySnapshot(cur);
    done.push(wk);
    console.log('  ✓', wk);
    cur = new Date(cur.getTime() + 7 * 86400000);
  }
  console.log(`\nDone. ${done.length} week(s) snapshotted: ${done[0]} … ${done[done.length - 1]}\n`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

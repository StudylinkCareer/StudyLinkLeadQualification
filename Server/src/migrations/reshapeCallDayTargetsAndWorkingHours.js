// Phase 0 of the Weekly/Monthly Report merge (planned 2026-08 with Hong Ha) —
// reshapes the two live target-setting tables that drive Weekly Report's
// "Calls by day" targets and the Uncontactable round-robin's fairness
// weighting. See the plan file for full rationale; summary:
//
//   call_day_targets: PRIMARY KEY (role, day_of_week) -> (role, month, day_of_week).
//     Pre-Sales rows are DROPPED — Pre-Sales no longer has a role-wide daily
//     target at all, only Counsellors do now (see below). Existing 7
//     Counselor rows are copied forward as-is into the first month (today's
//     VN month) — lossless, no manual refill needed.
//
//   presales_working_hours: UNIQUE (staff_id, month) with hours_per_day +
//     days_per_month -> UNIQUE (staff_id, month, day_of_week) with a single
//     `hours` column. The old shape never captured which specific days
//     someone works, only a monthly average, so this can only be
//     BEST-GUESS-prefilled, not losslessly reconstructed: days_per_month
//     close to a standard 5-day month (~21-22) is read as Mon-Fri, close to
//     a full calendar month (~30-31) is read as every day. Flagged in the
//     UI for Nhu (HR) to verify/correct — confirmed acceptable 2026-08.
//
// New Pre-Sales KPI formula (implemented in reportController.js /
// uncontactableTransfer.js, NOT here): target for (staff, day) =
// hours(staff, month, day_of_week) x 8, combined New+Ongoing (no split).
//
// Both reshaped tables fall back to the PREVIOUS month's values when a
// month has no rows of its own yet (implemented in the read endpoints, not
// as stored data) — never silently blank.
//
// Idempotent: safe to re-run (checks column existence / uses ON CONFLICT
// throughout). Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/reshapeCallDayTargetsAndWorkingHours.js
//   PROD: node src/migrations/reshapeCallDayTargetsAndWorkingHours.js --allow-remote
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

// VN-local "this month" as a 'YYYY-MM-01' date string.
function vnMonthKey(now = new Date()) {
  const VN_MS = 7 * 60 * 60 * 1000;
  const vn = new Date(now.getTime() + VN_MS);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// Best-guess weekday pattern from the old (hours_per_day, days_per_month)
// pair, checked against real prod data during planning:
//   ~21-22 days/month  -> standard Mon-Fri
//   ~28+   days/month  -> every day, Mon-Sun
//   anything else / 0  -> leave every day at 0 (nothing to guess from)
function guessWeekdayHours(hoursPerDay, daysPerMonth) {
  const h = Number(hoursPerDay) || 0;
  const d = Number(daysPerMonth) || 0;
  const perDow = [0, 0, 0, 0, 0, 0, 0]; // 0=Mon..6=Sun
  if (h <= 0 || d <= 0) return perDow;
  if (d >= 28) {
    for (let i = 0; i < 7; i++) perDow[i] = h;
  } else if (d >= 18) {
    for (let i = 0; i < 5; i++) perDow[i] = h; // Mon-Fri
  } else {
    // Ambiguous/sparse — leave at 0 rather than guess wrong; flagged for
    // manual entry same as an always-blank month would be.
  }
  return perDow;
}

(async () => {
  console.log('Target DB host: ' + host);
  const monthKey = vnMonthKey();
  console.log('Seeding first month as: ' + monthKey);

  // ── call_day_targets: add month, re-key, drop Pre-Sales ──────────────
  await pool.query(`ALTER TABLE call_day_targets ADD COLUMN IF NOT EXISTS month date`);
  // Backfill any pre-existing rows (old shape, no month) to this month
  // before re-keying, so the PK change below doesn't hit nulls.
  await pool.query(`UPDATE call_day_targets SET month = $1 WHERE month IS NULL`, [monthKey]);
  await pool.query(`ALTER TABLE call_day_targets ALTER COLUMN month SET NOT NULL`);
  await pool.query(`ALTER TABLE call_day_targets DROP CONSTRAINT IF EXISTS call_day_targets_pkey`);
  await pool.query(`ALTER TABLE call_day_targets ADD PRIMARY KEY (role, month, day_of_week)`);
  const droppedPresales = await pool.query(
    `DELETE FROM call_day_targets WHERE role = 'Pre-Sales' RETURNING role, day_of_week`
  );
  console.log(`call_day_targets: dropped ${droppedPresales.rowCount} Pre-Sales row(s), Counselor rows now keyed to month ${monthKey}.`);

  // ── presales_working_hours: add day_of_week, collapse to single `hours` ──
  await pool.query(`ALTER TABLE presales_working_hours ADD COLUMN IF NOT EXISTS day_of_week int`);
  await pool.query(`ALTER TABLE presales_working_hours ADD COLUMN IF NOT EXISTS hours numeric`);

  // Swap the UNIQUE constraint to (staff_id, month, day_of_week) BEFORE the
  // expansion loop below, not after — this was a real bug found running
  // against prod (2026-09): with the OLD (staff_id, month) constraint still
  // active during expansion, every day past the first for a given
  // (staff, month) silently hit ON CONFLICT DO NOTHING against THAT
  // constraint and got dropped, leaving only Monday's row per person. Safe
  // to do this swap even though day_of_week is still NULL on every
  // pre-existing row at this point — Postgres treats each NULL as distinct
  // under a UNIQUE constraint, so there's no spurious conflict yet.
  await pool.query(`ALTER TABLE presales_working_hours DROP CONSTRAINT IF EXISTS presales_working_hours_staff_id_month_key`);
  await pool.query(`ALTER TABLE presales_working_hours DROP CONSTRAINT IF EXISTS presales_working_hours_staff_month_dow_key`);
  await pool.query(
    `ALTER TABLE presales_working_hours
       ADD CONSTRAINT presales_working_hours_staff_month_dow_key UNIQUE (staff_id, month, day_of_week)`
  );

  // Guess-prefill hours per (staff, month, day_of_week) from each existing
  // (staff, month) row BEFORE dropping the old columns / re-keying, so we
  // still have hours_per_day/days_per_month to read from. Idempotent: if a
  // prior run already dropped those columns, there's nothing left to expand.
  const oldColsExist = (await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'presales_working_hours' AND column_name = 'hours_per_day'`
  )).rowCount > 0;
  if (oldColsExist) {
    const oldRows = (await pool.query(
      `SELECT id, staff_id, month, hours_per_day, days_per_month
         FROM presales_working_hours WHERE day_of_week IS NULL`
    )).rows;
    console.log(`presales_working_hours: expanding ${oldRows.length} old (staff, month) row(s) into per-weekday guesses...`);
    for (const row of oldRows) {
      const perDow = guessWeekdayHours(row.hours_per_day, row.days_per_month);
      // Delete the old single row for this (staff, month) — it's being
      // replaced by up to 7 new (staff, month, day_of_week) rows.
      await pool.query(`DELETE FROM presales_working_hours WHERE id = $1`, [row.id]);
      for (let dow = 0; dow < 7; dow++) {
        if (perDow[dow] <= 0) continue; // don't insert 0-hour days, matches "no row = 0" default
        await pool.query(
          `INSERT INTO presales_working_hours (staff_id, month, day_of_week, hours)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (staff_id, month, day_of_week) DO UPDATE SET hours = EXCLUDED.hours`,
          [row.staff_id, row.month, dow, perDow[dow]]
        );
      }
    }
  } else {
    console.log('presales_working_hours: old columns already gone, nothing to expand (idempotent re-run).');
  }

  await pool.query(`ALTER TABLE presales_working_hours ALTER COLUMN day_of_week SET NOT NULL`);
  await pool.query(`ALTER TABLE presales_working_hours ALTER COLUMN hours SET NOT NULL`);
  await pool.query(`ALTER TABLE presales_working_hours ALTER COLUMN hours SET DEFAULT 0`);
  await pool.query(`ALTER TABLE presales_working_hours DROP COLUMN IF EXISTS hours_per_day`);
  await pool.query(`ALTER TABLE presales_working_hours DROP COLUMN IF EXISTS days_per_month`);

  const finalRows = await pool.query(
    `SELECT s.full_name, to_char(wh.month,'YYYY-MM') AS month, wh.day_of_week, wh.hours
       FROM presales_working_hours wh JOIN staff s ON s.id = wh.staff_id
      ORDER BY s.full_name, wh.month, wh.day_of_week`
  );
  console.log('presales_working_hours final state:', JSON.stringify(finalRows.rows, null, 2));

  const finalDayTargets = await pool.query(
    `SELECT role, to_char(month,'YYYY-MM') AS month, day_of_week, new_target, ongoing_target
       FROM call_day_targets ORDER BY role, month, day_of_week`
  );
  console.log('call_day_targets final state:', JSON.stringify(finalDayTargets.rows, null, 2));

  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

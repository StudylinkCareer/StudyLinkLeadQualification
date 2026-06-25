// server/src/migrations/addMonthlyTargets.js
// Run once from the Server/ directory:
//   node src/migrations/addMonthlyTargets.js
//
// Creates two tables for the Weekly Report monthly target tracker:
//
//   monthly_targets       - per counsellor, per month contracted-signings target.
//                           `month` is a DATE pinned to the first of the month
//                           (e.g. 2026-06-01). One row per (staff_id, month).
//                           Where no row exists, the app falls back to
//                           staff.target (the existing single staff-level target).
//
//   target_tracked_staff  - the managed set of counsellors shown in the tracker.
//                           Managers add / remove members from the staff roster.
//                           Seeded here with the initial six, in display order.
//
// Idempotent: safe to re-run. Tables use IF NOT EXISTS; the seed matches staff
// by full_name and uses ON CONFLICT DO NOTHING, and it reports any of the six it
// could NOT find so you can add those via the UI instead.

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Initial tracked counsellors, in display (left-to-right) order.
// Matched to the staff table by full_name.
const SEED_COUNSELLORS = [
  'Trần Khiết Oanh',
  'Nguyễn Thị Hồng Hạnh',
  'Nguyễn Thị Mỹ Ly',
  'Nguyễn Thành Vinh',
  'La Tất Thành',
  'Nguyễn Thị Thu Lan',
];

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── monthly_targets ──────────────────────────────────────
    // One target per counsellor per month. month = first-of-month DATE.
    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_targets (
        id          SERIAL PRIMARY KEY,
        staff_id    INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
        month       DATE    NOT NULL,
        target      INTEGER NOT NULL CHECK (target >= 0),
        updated_by  TEXT,
        updated_at  TIMESTAMP DEFAULT NOW(),
        UNIQUE (staff_id, month)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_monthly_targets_month
        ON monthly_targets (month)
    `);

    // ── target_tracked_staff ─────────────────────────────────
    // The managed set of counsellors displayed in the tracker.
    await client.query(`
      CREATE TABLE IF NOT EXISTS target_tracked_staff (
        staff_id    INTEGER PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        added_by    TEXT,
        added_at    TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── Seed the initial six, matched by full_name ───────────
    const matched = [];
    const missing = [];
    let order = 1;
    for (const name of SEED_COUNSELLORS) {
      const r = await client.query(
        `SELECT id FROM staff WHERE full_name = $1 AND is_active = true`,
        [name]
      );
      if (r.rows.length === 0) {
        missing.push(name);
        continue;
      }
      await client.query(
        `INSERT INTO target_tracked_staff (staff_id, sort_order, added_by)
         VALUES ($1, $2, 'migration')
         ON CONFLICT (staff_id) DO NOTHING`,
        [r.rows[0].id, order]
      );
      matched.push(name);
      order++;
    }

    await client.query('COMMIT');

    console.log('[addMonthlyTargets] Tables ready: monthly_targets, target_tracked_staff');
    console.log(`[addMonthlyTargets] Seeded ${matched.length} tracked counsellor(s):`);
    matched.forEach(n => console.log(`    OK   ${n}`));
    if (missing.length) {
      console.log(`[addMonthlyTargets] ${missing.length} name(s) NOT found in active staff - add these via the UI:`);
      missing.forEach(n => console.log(`    MISS ${n}`));
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[addMonthlyTargets] Migration failed, rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate()
  .then(() => { console.log('[addMonthlyTargets] Done.'); process.exit(0); })
  .catch(() => process.exit(1));

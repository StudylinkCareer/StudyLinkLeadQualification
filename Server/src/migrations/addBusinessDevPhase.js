// migrations/addBusinessDevPhase.js
// -----------------------------------------------------------------------------
// Wire the new 'Business Development' phase into the phase state machine.
//
// Flow (user, 2026-07-10):
//   Pool ⇄ Business Development ; Business Development → Archived - Dir
//   ("Lost" is a lead STATUS close, not a phase move — handled by lead status.)
//   Pool may re-assign ONLY to Business Development or Pre-Sales →
//   so Pool → Counselling is DEACTIVATED here (⚠ behaviour change, reversible:
//   flip is_allowed back to true for ('Pool','Counselling')).
//
// Idempotent. Guarded to localhost/studylink_dev unless --allow-remote.
// Assumes phase_transitions / phase_positions already exist (addPhaseControlTables.js).
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const url = process.env.DATABASE_URL || '';
if (!process.argv.includes('--allow-remote') && !(url.includes('localhost') && url.includes('studylink_dev'))) {
  console.error('✗ Refusing to run: DATABASE_URL is not localhost/studylink_dev. Use --allow-remote for a deliberate PROD run.');
  process.exit(1);
}

// New allowed moves (is_allowed = true).
const ADD_ALLOWED = [
  ['Pool',                 'Business Development'],
  ['Business Development', 'Pool'],
  ['Business Development', 'Archived - Dir'],
];

// Moves to DEACTIVATE (kept as rows, is_allowed = false), re-asserted each run.
const DEACTIVATE = [
  ['Pool', 'Counselling'],   // Pool now re-assigns only to Business Development / Pre-Sales
];

// Positions editable in the Business Development phase.
const ADD_PHASE_POSITIONS = [
  ['Business Development', 'Business Development'],
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let added = 0;
    for (const [from, to] of ADD_ALLOWED) {
      const r = await client.query(
        `INSERT INTO phase_transitions (from_phase, to_phase, is_allowed)
         VALUES ($1, $2, true)
         ON CONFLICT (from_phase, to_phase) DO UPDATE SET is_allowed = true`,
        [from, to]);
      added += r.rowCount;
    }
    for (const [from, to] of DEACTIVATE) {
      await client.query(
        `INSERT INTO phase_transitions (from_phase, to_phase, is_allowed)
         VALUES ($1, $2, false)
         ON CONFLICT (from_phase, to_phase) DO UPDATE SET is_allowed = false`,
        [from, to]);
    }
    let pp = 0;
    for (const [phase, position] of ADD_PHASE_POSITIONS) {
      const r = await client.query(
        `INSERT INTO phase_positions (phase, position, is_active)
         VALUES ($1, $2, true)
         ON CONFLICT (phase, position) DO UPDATE SET is_active = true`,
        [phase, position]);
      pp += r.rowCount;
    }

    await client.query('COMMIT');
    console.log(`✓ Business Development wired. transitions upserted: ${ADD_ALLOWED.length} allowed + ${DEACTIVATE.length} deactivated; phase_positions: ${ADD_PHASE_POSITIONS.length}.`);

    const t = await client.query(
      `SELECT from_phase, string_agg(to_phase, ', ' ORDER BY to_phase) AS to_phases
         FROM phase_transitions WHERE is_allowed GROUP BY from_phase ORDER BY from_phase`);
    console.log('\nAllowed transitions now:');
    for (const r of t.rows) console.log(`  ${r.from_phase} -> ${r.to_phases}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✗ Failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();

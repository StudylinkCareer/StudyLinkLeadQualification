// Server/src/migrations/addPhaseControlTables.js
// ---------------------------------------------------------------------------
// Phase-driven model — stage A (data foundation).
// Creates the two ADMIN CONTROL TABLES that drive the Sales Order phase model:
//   1. phase_transitions  — from_phase -> allowed to_phase (the state machine)
//   2. phase_positions    — which staff positions are EDITABLE in each phase
// Both are admin-editable (Admin/Director/Manager) so the flows can be changed
// by simple selection/deselection. Seeds the agreed defaults.
//
// Non-destructive: CREATE TABLE IF NOT EXISTS + seed with ON CONFLICT DO NOTHING.
// Idempotent (safe to re-run; won't clobber admin edits).
//   node src/migrations/addPhaseControlTables.js                 # dev
//   node src/migrations/addPhaseControlTables.js --allow-remote  # PROD
// ---------------------------------------------------------------------------

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

// Canonical phases (order_phase values). "Counselling" is the phase the user
// calls "Counsellor"; "Presales" = "Pre-sales".
// Allowed phase moves (from -> [to]), seeded is_allowed = true.
const TRANSITIONS = {
  'Marketing':          ['Presales', 'Pool', 'Counselling'],
  'Presales':           ['Counselling', 'Pool'],
  'Pool':               ['Presales', 'Counselling', 'Archived - Dir'],
  'Counselling':        ['Pool', 'Case Officer - Dir'],
  'Case Officer - Dir': ['Pool', 'Archived - Dir'],
  'Case Officer - Sub': ['Archived - Sub'],
};

// Transitions kept as ROWS but seeded DEACTIVATED (is_allowed = false) so they
// appear in the admin editor switched off. Re-asserted off on each run (a
// structural default): Counselling must NOT hand off to Case Officer - Sub.
const DEACTIVATED = [
  ['Counselling', 'Case Officer - Sub'],
];

// Which staff positions are EDITABLE (active) in each phase. Position strings
// must match staff.position exactly (see LeadManagement Staff.jsx POSITIONS).
const PHASE_POSITIONS = {
  'Marketing':          ['Marketing Staff'],
  'Presales':           ['PreSales'],
  'Counselling':        ['Counselor', 'Senior Counselor'],
  'Pool':               ['Quality', 'Tech Support'],
  'Case Officer - Dir': ['Case Officer, Direct'],
  'Case Officer - Sub': ['Case Officer, Sub'],
  'Archived - Dir':     ['Quality', 'Tech Support'],
  'Archived - Sub':     ['Quality', 'Tech Support'],
};

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS phase_transitions (
        from_phase text    NOT NULL,
        to_phase   text    NOT NULL,
        is_allowed boolean NOT NULL DEFAULT true,
        PRIMARY KEY (from_phase, to_phase)
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS phase_positions (
        phase     text    NOT NULL,
        position  text    NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        PRIMARY KEY (phase, position)
      )`);

    let tCount = 0;
    for (const [from, tos] of Object.entries(TRANSITIONS)) {
      for (const to of tos) {
        const r = await client.query(
          `INSERT INTO phase_transitions (from_phase, to_phase, is_allowed)
           VALUES ($1, $2, true) ON CONFLICT (from_phase, to_phase) DO NOTHING`,
          [from, to]);
        tCount += r.rowCount;
      }
    }
    // Deactivated defaults: present as rows but is_allowed = false. Re-asserted
    // off each run so the structural rule holds even if seeded true earlier.
    for (const [from, to] of DEACTIVATED) {
      await client.query(
        `INSERT INTO phase_transitions (from_phase, to_phase, is_allowed)
         VALUES ($1, $2, false)
         ON CONFLICT (from_phase, to_phase) DO UPDATE SET is_allowed = false`,
        [from, to]);
    }

    let pCount = 0;
    for (const [phase, positions] of Object.entries(PHASE_POSITIONS)) {
      for (const position of positions) {
        const r = await client.query(
          `INSERT INTO phase_positions (phase, position, is_active)
           VALUES ($1, $2, true) ON CONFLICT (phase, position) DO NOTHING`,
          [phase, position]);
        pCount += r.rowCount;
      }
    }

    await client.query('COMMIT');
    console.log(`✓ phase_transitions ensured; seeded ${tCount} new transition(s).`);
    console.log(`✓ phase_positions ensured; seeded ${pCount} new phase-position pair(s).`);

    const t = await client.query(
      `SELECT from_phase, string_agg(to_phase, ', ' ORDER BY to_phase) AS to_phases
         FROM phase_transitions WHERE is_allowed GROUP BY from_phase ORDER BY from_phase`);
    console.log('\nAllowed transitions:');
    for (const r of t.rows) console.log(`  ${r.from_phase} -> ${r.to_phases}`);

    const p = await client.query(
      `SELECT phase, string_agg(position, ', ' ORDER BY position) AS positions
         FROM phase_positions WHERE is_active GROUP BY phase ORDER BY phase`);
    console.log('\nEditable positions per phase:');
    for (const r of p.rows) console.log(`  ${r.phase}: ${r.positions}`);
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

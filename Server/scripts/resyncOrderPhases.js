// scripts/resyncOrderPhases.js — recompute students.order_phase from the CURRENT
// owner's position (the live Model-A rule: order_phase = phaseForPosition(
// students.counselor -> staff.position)). order_phase is a stored SNAPSHOT, so it
// drifts whenever a staff position changes or an owner is reassigned without a
// re-sync — this fixes the drift.
//
// SAFE BY DEFAULT: preview only (no writes) unless --apply is passed. Idempotent
// (updates only rows whose computed phase differs from the stored one).
//
// Usage:
//   node scripts/resyncOrderPhases.js                      # preview ALL orders
//   node scripts/resyncOrderPhases.js --owner "Nguyễn Ngọc Hân"
//   node scripts/resyncOrderPhases.js --owner "Nguyễn Ngọc Hân" --apply
require('dotenv').config();
const { Pool } = require('pg');
const { phaseForPosition } = require('../src/utils/orderPhase');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ownerIdx = args.indexOf('--owner');
const OWNER = ownerIdx >= 0 ? args[ownerIdx + 1] : null;
// SAFE DEFAULT: only backfill orders with NO phase. --force-rederive re-derives ALL
// order_phase from the counselor (Model-A) which REVERTS deliberate explicit moves.
const FORCE = args.includes('--force-rederive');

const url = process.env.DATABASE_URL || '';
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

(async () => {
  console.log('Host:', (url.match(/@([^:@/]+)/) || [])[1] || '(?)');
  console.log('Scope:', OWNER ? `orders owned by "${OWNER}"` : 'ALL orders', '·', APPLY ? 'APPLY (writes)' : 'PREVIEW (no writes)');
  console.log('Mode :', FORCE ? '⚠ FORCE re-derive — OVERWRITES explicit phases (reverts moves!)' : 'backfill MISSING phases only (safe)', '\n');

  // Resolve each order's owner position, excluding synthetic event-rep staff rows
  // (matches syncOrderPhase()). Compute target phase and compare to stored.
  const where = OWNER ? 'WHERE s.counselor = $1' : '';
  const params = OWNER ? [OWNER] : [];
  const rows = (await pool.query(
    `SELECT s.student_id, s.counselor, s.order_phase AS current, st.position
       FROM students s
       LEFT JOIN staff st ON st.full_name = s.counselor AND COALESCE(st.staff_type,'') <> 'event'
       ${where}`,
    params
  )).rows;

  const changes = [];
  const transitions = {};
  for (const r of rows) {
    const target = phaseForPosition(r.position);
    const isMissing = !r.current;            // no phase set yet
    if (!FORCE && !isMissing) continue;      // safe default: only backfill missing
    if ((r.current || 'Pool') !== target) {
      changes.push({ id: r.student_id, from: r.current || '(null)', to: target });
      const key = `${r.current || '(null)'} → ${target}`;
      transitions[key] = (transitions[key] || 0) + 1;
    }
  }

  console.log(`Scanned ${rows.length} orders · ${changes.length} would change:\n`);
  Object.entries(transitions).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('  ' + String(n).padStart(5) + '  ' + k));
  if (!changes.length) { console.log('\nNothing to do — all in sync.'); await pool.end(); return; }

  if (!APPLY) {
    console.log('\nPREVIEW only. Re-run with --apply to write these changes.');
    await pool.end(); return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let done = 0;
    for (const c of changes) {
      await client.query(`UPDATE students SET order_phase = $1, updated_at = NOW() WHERE student_id = $2`, [c.to, c.id]);
      done++;
    }
    await client.query('COMMIT');
    console.log(`\n✅ Applied ${done} order_phase updates.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\n❌ Rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e); process.exit(1); });

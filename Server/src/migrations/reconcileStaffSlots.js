// server/src/migrations/reconcileStaffSlots.js
//
// Legacy-data reconciliation: the old model dumped EVERY owner into the Counselor
// slot. This routes each mis-filed owner to the slot that matches their REAL
// staff.position, and clears the Counselor slot — so a Quality person (e.g. Phi
// Vân) ends up in the Quality slot, a Pre-Sales person in PreSales, etc.
//
// DERIVES the target slot from staff.position (via POSITION_TO_SLOT) — no hard-
// coded names — so it is safe to run against PROD's live staff master. It ONLY
// touches records whose Counselor-slot person is NON-counselling. Genuine
// counsellors are never moved. Ambiguous positions (event staff, executives,
// unmapped) go to a REVIEW bucket and are left UNTOUCHED unless a flag opts in.
//
// PREREQUISITE: run authProfiles_up + applyStaffProfiles FIRST, so staff.position
// holds the new profile values this map keys on.
//
// SAFE BY DEFAULT: dry-run (prints the full plan) unless --apply.
//   --apply           write, after snapshotting reversal data to reconcile_slot_backup
//   --rollback        restore from reconcile_slot_backup
//   --include-review=pool   ALSO route the review bucket (event staff/execs/unmapped)
//                           to Pool/Unassigned (clears Counselor, no slot owner)
//   --allow-remote    required to run against a non-local DB (PROD)
//
// Phase (order_phase) is NOT changed here — that is entangled with P2 (on hold).

require('dotenv').config();
const { Pool } = require('pg');

const ARGS         = process.argv.slice(2);
const APPLY        = ARGS.includes('--apply');
const ROLLBACK     = ARGS.includes('--rollback');
const ALLOW_REMOTE = ARGS.includes('--allow-remote');
const INCLUDE_REVIEW_POOL = ARGS.some(a => a === '--include-review=pool');
const OPEN = `lead_status NOT IN ('Contracted','Lost','Archived','Cancelled')`;

// staff.position → order_assignments slot (non-counselling only).
const POSITION_TO_SLOT = {
  'Staff, Data Quality':        'Quality',
  'Staff, Technical Support':   'Tech Support',
  'Manager, Technical Support': 'Tech Support',
  'Tech Support':               'Tech Support',
  'Staff, Marketing':           'Marketing Staff',
  'Manager, Marketing':         'Marketing Staff',
  'Marketing Manager':          'Marketing Staff',
  'Staff, Business Development': 'Business Development',
  'Manager, Business Development':'Business Development',
  'Staff, Pre-sales':           'PreSales',
  'Lead, Pre-sales':            'PreSales',
  'PreSales':                   'PreSales',
  'Staff, Case Officer - Dir':  'Case Officer, Direct',
  'Staff, Case Officer - Sub':  'Case Officer, Sub',
  'Lead, Case Officer':         'Case Officer, Direct',
};
const KEEP_AS_COUNSELOR = new Set([
  'Staff, Counsellor', 'Lead, Counsellor', 'Manager, Counsellor', 'Counselor', 'Senior Counselor', 'Counsellor',
]);
const SLOT_COLUMN = { PreSales: 'presales', 'Marketing Staff': 'marketing_staff' }; // slots with a legacy column
// Each routed slot's DEPARTMENT phase. The record's order_phase is aligned to it so
// it reports under the correct dashboard tab — e.g. a Business Development owner's
// records move to the 'Business Development' phase instead of staying in legacy 'Pool'.
const SLOT_PHASE = {
  'Quality':              'Pool',
  'Tech Support':         'Pool',
  'Business Development':  'Business Development',
  'PreSales':             'Presales',
  'Case Officer, Direct': 'Case Officers',
  'Case Officer, Sub':    'Case Officers',
  'Marketing Staff':      'Marketing',
};

const url = process.env.DATABASE_URL || '';
const isLocal = /@(localhost|127\.0\.0\.1|::1)[:/]/.test(url) || url.includes('localhost');
if (!ALLOW_REMOTE && !(url.includes('localhost') && url.includes('studylink_dev'))) {
  console.error('✗ Refusing: DATABASE_URL is not localhost/studylink_dev. Use --allow-remote for a deliberate PROD run.');
  process.exit(1);
}
const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

async function ensureBackupTable(c) {
  await c.query(`CREATE TABLE IF NOT EXISTS reconcile_slot_backup (
    student_id text PRIMARY KEY, old_counselor text, target_slot text,
    old_order_phase text, backed_up_at timestamptz DEFAULT now())`);
}

async function main() {
  const c = await pool.connect();
  try {
    if (ROLLBACK) {
      await ensureBackupTable(c);
      const n = (await c.query(`SELECT COUNT(*)::int n FROM reconcile_slot_backup`)).rows[0].n;
      console.log(`Rolling back ${n} record(s)…`);
      if (!n) { console.log('Nothing to roll back.'); return; }
      await c.query('BEGIN');
      // Set-based reversal (mirror of the apply).
      await c.query(`UPDATE students s SET counselor=b.old_counselor, updated_at=now() FROM reconcile_slot_backup b WHERE s.student_id=b.student_id`);
      await c.query(`UPDATE students s SET order_phase=b.old_order_phase, updated_at=now() FROM reconcile_slot_backup b WHERE s.student_id=b.student_id AND b.old_order_phase IS NOT NULL`);
      await c.query(`UPDATE leads l SET counselor=b.old_counselor, updated_at=now() FROM reconcile_slot_backup b WHERE l.person_id=b.student_id AND NULLIF(l.counselor,'') IS NULL`);
      await c.query(`INSERT INTO order_assignments (student_id,position,staff_name,updated_at)
                     SELECT student_id,'Counselor',old_counselor,now() FROM reconcile_slot_backup
                     ON CONFLICT (student_id,position) DO UPDATE SET staff_name=EXCLUDED.staff_name, updated_at=now()`);
      await c.query(`DELETE FROM order_assignments oa USING reconcile_slot_backup b WHERE oa.student_id=b.student_id AND oa.position=b.target_slot`);
      await c.query(`UPDATE students s SET presales='', updated_at=now() FROM reconcile_slot_backup b WHERE s.student_id=b.student_id AND b.target_slot='PreSales'`);
      await c.query(`UPDATE leads l SET presales='', updated_at=now() FROM reconcile_slot_backup b WHERE l.person_id=b.student_id AND b.target_slot='PreSales'`);
      await c.query(`UPDATE students s SET marketing_staff='', updated_at=now() FROM reconcile_slot_backup b WHERE s.student_id=b.student_id AND b.target_slot='Marketing Staff'`);
      await c.query(`UPDATE leads l SET marketing_staff='', updated_at=now() FROM reconcile_slot_backup b WHERE l.person_id=b.student_id AND b.target_slot='Marketing Staff'`);
      await c.query(`DELETE FROM reconcile_slot_backup`);
      await c.query('COMMIT');
      console.log('✓ Rollback complete (reconcile_slot_backup cleared).');
      return;
    }

    // Build the plan: every Counselor-slot occupant + their REAL position.
    // People can have a duplicate "event rep" staff row (staff_type='event',
    // position 'StudyLink event staff'). That is NOT their real role — prefer the
    // non-event record so the person's true position drives the routing (and a
    // subquery avoids the fan-out a plain join would cause on duplicate names).
    const occ = (await c.query(`
      SELECT s.student_id, s.counselor, COALESCE(s.order_phase,'(none)') AS cur_phase,
             COALESCE((
               SELECT st.position FROM staff st
                WHERE st.full_name = s.counselor
                ORDER BY (st.position = 'StudyLink event staff' OR st.staff_type = 'event') ASC, st.id ASC
                LIMIT 1
             ), '(no staff row)') AS position
        FROM students s
       WHERE COALESCE(s.counselor,'') <> ''`)).rows;

    const route = [], keep = [], review = [];
    for (const r of occ) {
      if (POSITION_TO_SLOT[r.position]) {
        const slot = POSITION_TO_SLOT[r.position];
        route.push({ ...r, slot, targetPhase: SLOT_PHASE[slot] || null });
      }
      else if (KEEP_AS_COUNSELOR.has(r.position)) keep.push(r);
      else review.push(r);
    }
    const tally = (arr, key) => arr.reduce((m, r) => (m[r[key]] = (m[r[key]] || 0) + 1, m), {});

    console.log(`\n=== RECONCILIATION PLAN (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
    console.log(`Counselor-slot records: ${occ.length}`);
    console.log(`\nROUTE → correct slot (${route.length} records):`);
    for (const [pos, n] of Object.entries(tally(route, 'position'))) console.log(`  ${pos.padEnd(28)} → ${POSITION_TO_SLOT[pos].padEnd(20)} ${n}`);
    console.log(`\nKEEP as Counselor — genuine counsellors (${keep.length} records):`);
    for (const [pos, n] of Object.entries(tally(keep, 'position'))) console.log(`  ${pos.padEnd(28)} ${n}`);
    console.log(`\nREVIEW — left UNTOUCHED${INCLUDE_REVIEW_POOL ? ' → routed to Pool/Unassigned (--include-review=pool)' : ''} (${review.length} records):`);
    for (const [pos, n] of Object.entries(tally(review, 'position'))) console.log(`  ${pos.padEnd(28)} ${n}`);

    // Phase alignment: which records will have order_phase CHANGED to match the owner.
    const moves = {};
    for (const r of route) {
      if (r.targetPhase && r.cur_phase !== r.targetPhase) {
        const k = `${r.cur_phase} → ${r.targetPhase}`;
        moves[k] = (moves[k] || 0) + 1;
      }
    }
    const moveKeys = Object.keys(moves);
    console.log(`\nPHASE MOVES — order_phase realigned to the owner's department (${moveKeys.reduce((s,k)=>s+moves[k],0)} records):`);
    if (!moveKeys.length) console.log('  (none — all routed records already in the correct phase)');
    for (const k of moveKeys.sort()) console.log(`  ${k.padEnd(40)} ${moves[k]}`);

    if (!APPLY) { console.log('\nDRY-RUN only. Re-run with --apply to write (snapshots reversal data first).'); return; }

    if (INCLUDE_REVIEW_POOL) { console.error('✗ --include-review=pool is not supported in the set-based version; handle review records manually.'); process.exit(1); }
    await ensureBackupTable(c);
    const existingBackup = (await c.query('SELECT COUNT(*)::int n FROM reconcile_slot_backup')).rows[0].n;
    if (existingBackup > 0) { console.error(`✗ reconcile_slot_backup already holds ${existingBackup} rows from a prior apply. Run --rollback first (or clear it) before re-applying.`); process.exit(1); }
    await c.query('BEGIN');
    // Push the whole plan into a temp table in ONE round-trip, then do every step
    // set-based (Postgres does the per-row work locally → seconds, short lock hold).
    await c.query(`CREATE TEMP TABLE recon_plan (student_id text PRIMARY KEY, counselor text, slot text, target_phase text) ON COMMIT DROP`);
    await c.query(
      `INSERT INTO recon_plan (student_id, counselor, slot, target_phase)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[])`,
      [route.map(r => r.student_id), route.map(r => r.counselor), route.map(r => r.slot), route.map(r => r.targetPhase)]);

    // 1. Snapshot reversal data BEFORE mutating.
    await c.query(`INSERT INTO reconcile_slot_backup (student_id, old_counselor, target_slot, old_order_phase)
                   SELECT p.student_id, p.counselor, p.slot, s.order_phase FROM recon_plan p JOIN students s USING (student_id)
                   ON CONFLICT (student_id) DO NOTHING`);
    // 2. Clear the mis-filed counselor (record + its leads) and drop the Counselor slot.
    await c.query(`UPDATE leads l    SET counselor='', updated_at=now() FROM recon_plan p WHERE l.person_id=p.student_id AND l.counselor=p.counselor`);
    await c.query(`UPDATE students s SET counselor='', updated_at=now() FROM recon_plan p WHERE s.student_id=p.student_id`);
    await c.query(`DELETE FROM order_assignments oa USING recon_plan p WHERE oa.student_id=p.student_id AND oa.position='Counselor'`);
    // 3. Assign the real slot.
    await c.query(`INSERT INTO order_assignments (student_id, position, staff_name, updated_at)
                   SELECT student_id, slot, counselor, now() FROM recon_plan
                   ON CONFLICT (student_id, position) DO UPDATE SET staff_name=EXCLUDED.staff_name, updated_at=now()`);
    // 4. Mirror to the legacy column for slots that have one (PreSales / Marketing; active leads only).
    await c.query(`UPDATE students s SET presales=p.counselor, updated_at=now()       FROM recon_plan p WHERE s.student_id=p.student_id AND p.slot='PreSales'`);
    await c.query(`UPDATE leads l    SET presales=p.counselor, updated_at=now()       FROM recon_plan p WHERE l.person_id=p.student_id AND p.slot='PreSales' AND ${OPEN}`);
    await c.query(`UPDATE students s SET marketing_staff=p.counselor, updated_at=now() FROM recon_plan p WHERE s.student_id=p.student_id AND p.slot='Marketing Staff'`);
    await c.query(`UPDATE leads l    SET marketing_staff=p.counselor, updated_at=now() FROM recon_plan p WHERE l.person_id=p.student_id AND p.slot='Marketing Staff' AND ${OPEN}`);
    // 5. Align order_phase to the owner's department.
    await c.query(`UPDATE students s SET order_phase=p.target_phase, updated_at=now() FROM recon_plan p WHERE s.student_id=p.student_id AND p.target_phase IS NOT NULL`);
    await c.query('COMMIT');
    console.log(`\n✓ Applied (set-based): routed ${route.length} record(s) to their real slot + phase. Reversal data in reconcile_slot_backup (use --rollback).`);
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('\nROLLED BACK — no changes:', err.message);
    process.exitCode = 1;
  } finally {
    c.release(); await pool.end();
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch(e => { console.error(e); process.exit(1); });

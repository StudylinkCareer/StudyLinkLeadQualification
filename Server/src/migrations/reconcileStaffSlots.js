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
    leads_cleared int[], leads_legacy_set int[], backed_up_at timestamptz DEFAULT now())`);
}

async function main() {
  const c = await pool.connect();
  try {
    if (ROLLBACK) {
      await ensureBackupTable(c);
      const rows = (await c.query(`SELECT * FROM reconcile_slot_backup`)).rows;
      console.log(`Rolling back ${rows.length} record(s)…`);
      await c.query('BEGIN');
      for (const b of rows) {
        await c.query(`UPDATE students SET counselor=$1 WHERE student_id=$2`, [b.old_counselor, b.student_id]);
        if (b.leads_cleared?.length) await c.query(`UPDATE leads SET counselor=$1 WHERE lead_id = ANY($2)`, [b.old_counselor, b.leads_cleared]);
        await c.query(`INSERT INTO order_assignments (student_id,position,staff_name,updated_at) VALUES ($1,'Counselor',$2,now())
                       ON CONFLICT (student_id,position) DO UPDATE SET staff_name=EXCLUDED.staff_name, updated_at=now()`, [b.student_id, b.old_counselor]);
        await c.query(`DELETE FROM order_assignments WHERE student_id=$1 AND position=$2`, [b.student_id, b.target_slot]);
        const col = SLOT_COLUMN[b.target_slot];
        if (col) {
          await c.query(`UPDATE students SET ${col}='' WHERE student_id=$1`, [b.student_id]);
          if (b.leads_legacy_set?.length) await c.query(`UPDATE leads SET ${col}='' WHERE lead_id = ANY($1)`, [b.leads_legacy_set]);
        }
      }
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
      SELECT s.student_id, s.counselor,
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
      if (POSITION_TO_SLOT[r.position]) route.push({ ...r, slot: POSITION_TO_SLOT[r.position] });
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

    if (!APPLY) { console.log('\nDRY-RUN only. Re-run with --apply to write (snapshots reversal data first).'); return; }

    await ensureBackupTable(c);
    await c.query('BEGIN');
    let applied = 0, pooled = 0;
    const doClearCounselor = async (studentId, name) => {
      const cleared = (await c.query(`UPDATE leads SET counselor='' WHERE person_id=$1 AND counselor=$2 RETURNING lead_id`, [studentId, name])).rows.map(x => x.lead_id);
      await c.query(`UPDATE students SET counselor='' WHERE student_id=$1`, [studentId]);
      await c.query(`DELETE FROM order_assignments WHERE student_id=$1 AND position='Counselor'`, [studentId]);
      return cleared;
    };
    for (const r of route) {
      const cleared = await doClearCounselor(r.student_id, r.counselor);
      // assign the real slot
      await c.query(`INSERT INTO order_assignments (student_id,position,staff_name,updated_at) VALUES ($1,$2,$3,now())
                     ON CONFLICT (student_id,position) DO UPDATE SET staff_name=EXCLUDED.staff_name, updated_at=now()`, [r.student_id, r.slot, r.counselor]);
      let legacySet = [];
      const col = SLOT_COLUMN[r.slot];
      if (col) {
        await c.query(`UPDATE students SET ${col}=$1 WHERE student_id=$2`, [r.counselor, r.student_id]);
        legacySet = (await c.query(`UPDATE leads SET ${col}=$1 WHERE person_id=$2 AND ${OPEN} RETURNING lead_id`, [r.counselor, r.student_id])).rows.map(x => x.lead_id);
      }
      await c.query(`INSERT INTO reconcile_slot_backup (student_id,old_counselor,target_slot,leads_cleared,leads_legacy_set)
                     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (student_id) DO NOTHING`, [r.student_id, r.counselor, r.slot, cleared, legacySet]);
      applied++;
    }
    if (INCLUDE_REVIEW_POOL) {
      for (const r of review) {
        const cleared = await doClearCounselor(r.student_id, r.counselor);
        await c.query(`INSERT INTO reconcile_slot_backup (student_id,old_counselor,target_slot,leads_cleared,leads_legacy_set)
                       VALUES ($1,$2,'(pool)',$3,'{}') ON CONFLICT (student_id) DO NOTHING`, [r.student_id, r.counselor, cleared]);
        pooled++;
      }
    }
    await c.query('COMMIT');
    console.log(`\n✓ Applied: routed ${applied} record(s) to their real slot${INCLUDE_REVIEW_POOL ? `, sent ${pooled} review record(s) to Pool/Unassigned` : ''}. Reversal data in reconcile_slot_backup (use --rollback).`);
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('\nROLLED BACK — no changes:', err.message);
    process.exitCode = 1;
  } finally {
    c.release(); await pool.end();
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch(e => { console.error(e); process.exit(1); });

// Server/src/migrations/mergeStaffDuplicates.js
// ---------------------------------------------------------------------------
// Staff-table cleanup: collapse duplicate logins so each individual has ONE
// staff record. Driven by an explicit plan on the command line — nothing is
// guessed from names.
//
//   --merge DUP=KEEP     same person, two rows: repoint every reference from
//                        DUP to KEEP (desk sessions, desk visits, notes,
//                        check-ins, event_reps links, source_staff_id), then
//                        DELETE the DUP row. Event sign-in links move with
//                        their token+PIN preserved; where BOTH rows hold an
//                        active link on the same event, KEEP's link survives
//                        and DUP's is deactivated. Repeatable / comma list.
//   --retire ID[,ID]     not a real individual (e.g. "New Staff Meeting"):
//                        deactivate its event_reps links; DELETE the staff row
//                        if nothing references it, otherwise hide it from the
//                        Staff list (is_active=false + staff_type='event').
//   --purge-synthetic    delete old deactivated synthetic rep rows
//                        (staff_type='event' AND is_active=false) that nothing
//                        references any more; referenced ones are kept.
//   --dry-run            print what would happen, write nothing.
//
//   node src/migrations/mergeStaffDuplicates.js --dry-run --merge 92=18 ...
//   node src/migrations/mergeStaffDuplicates.js --allow-remote --merge ...  # PROD
// ---------------------------------------------------------------------------
require('dotenv').config();
const { Pool } = require('pg');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ALLOW_REMOTE = args.includes('--allow-remote');
const PURGE_SYNTHETIC = args.includes('--purge-synthetic');
const MERGES = [];            // [{dup, keep}]
const RETIRES = [];           // [id]
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--merge' && args[i + 1]) {
    for (const pair of args[++i].split(',')) {
      const m = pair.match(/^(\d+)=(\d+)$/);
      if (!m) { console.error(`Bad --merge "${pair}" (want DUP=KEEP)`); process.exit(1); }
      MERGES.push({ dup: +m[1], keep: +m[2] });
    }
  } else if (args[i] === '--retire' && args[i + 1]) {
    for (const id of args[++i].split(',')) {
      if (!/^\d+$/.test(id)) { console.error(`Bad --retire id "${id}"`); process.exit(1); }
      RETIRES.push(+id);
    }
  }
}
if (!MERGES.length && !RETIRES.length && !PURGE_SYNTHETIC) {
  console.error('Nothing to do — pass --merge DUP=KEEP, --retire ID and/or --purge-synthetic.');
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

// Every column that references staff(id). History tables are REPOINTED on merge
// (same individual, so attribution stays truthful); per-person config tables are
// repointed too, falling back to DELETE of the dup's rows if the keep row already
// has one (unique-key collision) — a temp login's config is disposable.
const HISTORY_REFS = [
  ['desk_sessions', 'staff_id'],
  ['event_desk_visits', 'recorded_by'],
  ['student_notes', 'author_id'],
  ['event_attendees', 'checked_in_by'],
  ['staff', 'source_staff_id'],
];
const CONFIG_REFS = [
  ['user_variants', 'staff_id'],
  ['staff_office_assignments', 'staff_id'],
  ['monthly_targets', 'staff_id'],
  ['target_tracked_staff', 'staff_id'],
];
const ALL_REFS = [...HISTORY_REFS, ...CONFIG_REFS, ['event_reps', 'staff_id']];

const exists = async (client, table) =>
  (await client.query(`SELECT to_regclass($1) t`, [`public.${table}`])).rows[0].t !== null;

async function refCounts(client, staffId) {
  const out = [];
  for (const [table, col] of ALL_REFS) {
    if (!(await exists(client, table))) continue;
    const n = (await client.query(`SELECT COUNT(*)::int n FROM ${table} WHERE ${col} = $1`, [staffId])).rows[0].n;
    if (n) out.push(`${table}.${col}=${n}`);
  }
  return out;
}

async function staffLabel(client, id) {
  const r = await client.query(`SELECT full_name, email, position, is_active FROM staff WHERE id = $1`, [id]);
  if (!r.rowCount) return null;
  const s = r.rows[0];
  return `#${id} ${s.full_name} <${s.email}> [${s.position}${s.is_active ? '' : ', INACTIVE'}]`;
}

async function merge(client, { dup, keep }) {
  const dupL = await staffLabel(client, dup), keepL = await staffLabel(client, keep);
  if (!dupL || !keepL) throw new Error(`merge ${dup}=${keep}: staff row missing (${!dupL ? dup : keep})`);
  console.log(`MERGE ${dupL}\n  --> ${keepL}`);
  console.log(`  refs on dup: ${(await refCounts(client, dup)).join(', ') || '(none)'}`);
  if (DRY) return;

  await client.query('BEGIN');
  try {
    // event_reps: keep's active link wins per event; otherwise move the link
    // (token+PIN travel with it, so a distributed sign-in link keeps working).
    const links = (await client.query(
      `SELECT id, event_id, is_active FROM event_reps WHERE staff_id = $1`, [dup])).rows;
    for (const l of links) {
      const clash = l.is_active && (await client.query(
        `SELECT 1 FROM event_reps WHERE event_id = $1 AND staff_id = $2 AND is_active = true`,
        [l.event_id, keep])).rowCount > 0;
      if (clash) {
        // Keep's link survives; the dup's link is retired AND repointed so the
        // dup row can be deleted (partial unique idx only covers active links).
        await client.query(`UPDATE event_reps SET is_active = false, staff_id = $1 WHERE id = $2`, [keep, l.id]);
        console.log(`  link ${l.id} (event ${l.event_id}): keep already on roster — dup link deactivated`);
      } else {
        await client.query(`UPDATE event_reps SET staff_id = $1 WHERE id = $2`, [keep, l.id]);
        console.log(`  link ${l.id} (event ${l.event_id}): repointed, sign-in link preserved`);
      }
    }

    for (const [table, col] of HISTORY_REFS) {
      if (!(await exists(client, table))) continue;
      const r = await client.query(`UPDATE ${table} SET ${col} = $1 WHERE ${col} = $2`, [keep, dup]);
      if (r.rowCount) console.log(`  ${table}.${col}: ${r.rowCount} row(s) repointed`);
    }
    for (const [table, col] of CONFIG_REFS) {
      if (!(await exists(client, table))) continue;
      await client.query('SAVEPOINT cfg');
      try {
        const r = await client.query(`UPDATE ${table} SET ${col} = $1 WHERE ${col} = $2`, [keep, dup]);
        if (r.rowCount) console.log(`  ${table}.${col}: ${r.rowCount} row(s) repointed`);
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT cfg');
        const r = await client.query(`DELETE FROM ${table} WHERE ${col} = $1`, [dup]);
        console.log(`  ${table}.${col}: keep already configured — ${r.rowCount} dup row(s) dropped`);
      }
      await client.query('RELEASE SAVEPOINT cfg');
    }

    await client.query(`DELETE FROM staff WHERE id = $1`, [dup]);
    await client.query('COMMIT');
    console.log(`  ✓ dup row #${dup} deleted`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function retire(client, id) {
  const label = await staffLabel(client, id);
  if (!label) throw new Error(`retire ${id}: staff row missing`);
  console.log(`RETIRE ${label}`);
  if (DRY) {
    console.log(`  refs: ${(await refCounts(client, id)).join(', ') || '(none — row would be deleted)'}`);
    return;
  }
  await client.query('BEGIN');
  try {
    const links = await client.query(
      `UPDATE event_reps SET is_active = false WHERE staff_id = $1 AND is_active = true`, [id]);
    if (links.rowCount) console.log(`  ${links.rowCount} roster link(s) deactivated`);

    const refs = [];
    for (const [table, col] of ALL_REFS) {
      if (!(await exists(client, table))) continue;
      const n = (await client.query(`SELECT COUNT(*)::int n FROM ${table} WHERE ${col} = $1`, [id])).rows[0].n;
      if (n) refs.push(`${table}=${n}`);
    }
    if (refs.length === 0) {
      await client.query(`DELETE FROM staff WHERE id = $1`, [id]);
      console.log(`  ✓ no references — row deleted`);
    } else {
      // Referenced history must keep its author — hide the row from the Staff
      // list instead (findAll filters staff_type='event').
      await client.query(`UPDATE staff SET is_active = false, staff_type = 'event' WHERE id = $1`, [id]);
      console.log(`  ✓ referenced (${refs.join(', ')}) — deactivated + hidden from Staff list`);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function purgeSynthetic(client) {
  const rows = (await client.query(
    `SELECT id, full_name, email FROM staff WHERE staff_type = 'event' AND is_active = false ORDER BY id`)).rows;
  console.log(`PURGE-SYNTHETIC: ${rows.length} deactivated synthetic row(s) to inspect`);
  let deleted = 0, kept = 0;
  for (const s of rows) {
    const refs = await refCounts(client, s.id);
    if (refs.length) {
      console.log(`  keep  #${s.id} ${s.full_name} — referenced (${refs.join(', ')})`);
      kept++;
      continue;
    }
    console.log(`  ${DRY ? 'would delete' : 'delete'} #${s.id} ${s.full_name} <${s.email}>`);
    if (!DRY) await client.query(`DELETE FROM staff WHERE id = $1`, [s.id]);
    deleted++;
  }
  console.log(`  ✓ ${deleted} ${DRY ? 'deletable' : 'deleted'}, ${kept} kept (referenced)`);
}

(async () => {
  const client = await pool.connect();
  try {
    console.log(`Host: ${host}${DRY ? '  (DRY RUN — no writes)' : ''}`);
    for (const m of MERGES) await merge(client, m);
    for (const id of RETIRES) await retire(client, id);
    if (PURGE_SYNTHETIC) await purgeSynthetic(client);
    console.log('Done.');
  } catch (e) {
    console.error('✗ FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();

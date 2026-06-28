// server/src/migrations/renameApplicationsToLeads.js
//
// PERSON / LEAD restructure — rename the engagement table to its true name.
//
//   applications        -> leads
//   applications.application_id (int PK)  -> leads.lead_id        (STAYS auto-increment integer)
//   student_notes.application_id (int FK) -> student_notes.lead_id
//   documents.application_id     (int FK) -> documents.lead_id
//   audit_log.application_id     (int FK) -> audit_log.lead_id
//   leads.person_id  -> unchanged (FK to students.student_id)
//
// The lead_id stays a plain integer per the design decision (the human context is
// the student_id + descriptive columns; the lead's own id only needs to be unique).
// Constraint/index/sequence NAMES that embed 'application' are tidied to 'lead'/'leads'.
//
// Purely a DB rename: no runtime code references `applications` yet, so there is
// nothing in controllers/routes/services to change.
//
// SAFETY
//   * DEV GUARD — aborts unless DATABASE_URL host is localhost (--allow-remote to override; NOT used here).
//   * Transaction-wrapped; rolls back on any error or failed verification.
//   * Idempotent — detects whether the rename is already applied and no-ops.
//   * --reset reverses everything (leads -> applications, lead_id -> application_id).
//
// USAGE (from Server/, DATABASE_URL -> studylink_dev):
//   node src/migrations/renameApplicationsToLeads.js            # rename forward
//   node src/migrations/renameApplicationsToLeads.js --reset    # undo

require('dotenv').config();
const { Pool } = require('pg');

const ARGS         = process.argv.slice(2);
const RESET        = ARGS.includes('--reset');
const ALLOW_REMOTE = ARGS.includes('--allow-remote');

const ENG   = RESET ? 'applications'   : 'leads';          // engagement table name AFTER this run
const IDCOL = RESET ? 'application_id' : 'lead_id';        // its id column AFTER this run
const CHILD = ['student_notes', 'documents', 'audit_log'];

function hostOf(url) {
  const m = /@([^:@/]+)(?::\d+)?\//.exec(url || '');
  return m ? m[1] : '(unparseable)';
}

// Cosmetic name tidy-ups, expressed forward (applications -> leads). For --reset
// we swap from/to and flip the engagement table name (leads -> applications).
const FWD = [
  ['constraint', 'leads',         'applications_pkey',              'leads_pkey'],
  ['constraint', 'leads',         'applications_person_fk',         'leads_person_fk'],
  ['constraint', 'student_notes', 'student_notes_application_fk',   'student_notes_lead_fk'],
  ['constraint', 'documents',     'documents_application_fk',       'documents_lead_fk'],
  ['constraint', 'audit_log',     'audit_log_application_fk',       'audit_log_lead_fk'],
  ['index',      null,            'idx_applications_person',        'idx_leads_person'],
  ['index',      null,            'idx_applications_status',        'idx_leads_status'],
  ['index',      null,            'idx_student_notes_application',  'idx_student_notes_lead'],
  ['index',      null,            'idx_documents_application',      'idx_documents_lead'],
  ['index',      null,            'idx_audit_application',          'idx_audit_lead'],
  ['sequence',   null,            'applications_application_id_seq','leads_lead_id_seq'],
];

async function renameObj(client, kind, table, from, to) {
  let present = 0;
  if (kind === 'constraint') {
    present = (await client.query(
      `SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass`, [from, table])).rowCount;
    if (present) await client.query(`ALTER TABLE ${table} RENAME CONSTRAINT "${from}" TO "${to}"`);
  } else if (kind === 'index') {
    present = (await client.query(`SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = $1`, [from])).rowCount;
    if (present) await client.query(`ALTER INDEX "${from}" RENAME TO "${to}"`);
  } else if (kind === 'sequence') {
    present = (await client.query(`SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = $1`, [from])).rowCount;
    if (present) await client.query(`ALTER SEQUENCE "${from}" RENAME TO "${to}"`);
  }
  console.log(`  ${present ? 'renamed' : 'skip (absent)'}: ${from} -> ${to}`);
}

async function main() {
  const url  = process.env.DATABASE_URL || '';
  const host = hostOf(url);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);

  console.log(`Target DB host: ${host}`);
  console.log(`Direction: ${RESET ? 'leads -> applications  (--reset)' : 'applications -> leads'}`);
  if (!isLocal && !ALLOW_REMOTE) {
    console.error(`\nABORT: refuses to run against non-local host "${host}". Point DATABASE_URL at studylink_dev.`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();

  const reg = async (name) => (await client.query(`SELECT to_regclass($1) AS t`, [name])).rows[0].t;

  try {
    await client.query('BEGIN');

    const fromTbl = RESET ? 'leads'        : 'applications';
    const toTbl   = RESET ? 'applications' : 'leads';

    // ── Pre-flight ───────────────────────────────────────────────────────────
    if (await reg(toTbl) && !(await reg(fromTbl))) {
      console.log(`\nNothing to do — "${toTbl}" already exists (rename already applied).`);
      await client.query('ROLLBACK');
      return;
    }
    if (!(await reg(fromTbl))) {
      throw new Error(`Expected table "${fromTbl}" to exist but it does not — aborting.`);
    }

    // ── 1. Rename the table ──────────────────────────────────────────────────
    await client.query(`ALTER TABLE ${fromTbl} RENAME TO ${toTbl}`);
    console.log(`Renamed table ${fromTbl} -> ${toTbl}`);

    // ── 2. Rename the id column on the engagement table + the child FK columns ─
    const fromCol = RESET ? 'lead_id' : 'application_id';
    const toCol   = RESET ? 'application_id' : 'lead_id';
    await client.query(`ALTER TABLE ${toTbl} RENAME COLUMN ${fromCol} TO ${toCol}`);
    console.log(`Renamed column ${toTbl}.${fromCol} -> ${toCol}`);
    for (const t of CHILD) {
      await client.query(`ALTER TABLE ${t} RENAME COLUMN ${fromCol} TO ${toCol}`);
      console.log(`Renamed column ${t}.${fromCol} -> ${toCol}`);
    }

    // ── 3. Tidy constraint / index / sequence names ──────────────────────────
    console.log('Tidying object names:');
    for (const [kind, table, from, to] of FWD) {
      const tbl = table === 'leads' ? toTbl : table;          // engagement table follows the rename
      if (RESET) await renameObj(client, kind, tbl, to, from);
      else       await renameObj(client, kind, tbl, from, to);
    }

    // ── 4. Verify before commit ──────────────────────────────────────────────
    const n = async (sql) => (await client.query(sql)).rows[0].n;
    const students = await n(`SELECT count(*)::int n FROM students`);
    const engRows  = await n(`SELECT count(*)::int n FROM ${ENG}`);
    const orphanN  = await n(`SELECT count(*)::int n FROM student_notes sn LEFT JOIN ${ENG} e ON e.${IDCOL} = sn.${IDCOL} WHERE sn.${IDCOL} IS NOT NULL AND e.${IDCOL} IS NULL`);
    const orphanD  = await n(`SELECT count(*)::int n FROM documents     d  LEFT JOIN ${ENG} e ON e.${IDCOL} = d.${IDCOL}  WHERE d.${IDCOL}  IS NOT NULL AND e.${IDCOL} IS NULL`);
    const sample   = (await client.query(
      `SELECT e.${IDCOL} AS id, e.person_id, e.lead_status
         FROM ${ENG} e ORDER BY e.${IDCOL} LIMIT 5`)).rows;

    console.log('\n── Verification ───────────────────────────────');
    console.log(`students                     : ${students}`);
    console.log(`${ENG.padEnd(28)} : ${engRows}   ${engRows === students ? 'OK (1 per student today)' : 'NOTE: not 1:1'}`);
    console.log(`orphan student_notes         : ${orphanN}   ${orphanN === 0 ? 'OK' : 'BROKEN!'}`);
    console.log(`orphan documents             : ${orphanD}   ${orphanD === 0 ? 'OK' : 'BROKEN!'}`);
    console.log(`sample ${ENG}.${IDCOL} -> person_id / status:`);
    for (const r of sample) console.log(`   ${String(r.id).padStart(5)}  ${r.person_id}  ${r.lead_status || '—'}`);

    if (orphanN !== 0 || orphanD !== 0) {
      throw new Error('FK verification failed — child rows reference a missing engagement row. Rolling back.');
    }

    await client.query('COMMIT');
    console.log(`\nCOMMITTED — engagement table is now "${toTbl}" (id column "${toCol}").`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nROLLED BACK — no changes made:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch(e => { console.error(e); process.exit(1); });

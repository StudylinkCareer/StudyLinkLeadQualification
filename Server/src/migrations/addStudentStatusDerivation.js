// server/src/migrations/addStudentStatusDerivation.js
//
// Student-status model. `students.student_status` already exists (addStudentStatus.js);
// this layers on:
//   1. The lookup_values catalogue for the 6 statuses (New, In progress, Enrolled,
//      Farming, Returning, Transferred).
//   2. A derive_student_status(person_id) SQL function — "best lead wins":
//        Enrolled    : any lead Contracted
//        In progress : any OPEN lead in active engagement
//        Returning   : a fresh New lead AND an older dead lead (came back)
//        New         : New/blank lead, no prior dead
//        Farming     : all leads dead (Lost / Not contactable / Archived)
//   3. A trigger that re-derives a student's status whenever one of their leads'
//      STATUS changes (insert / delete / update of lead_status). Counsellor-only
//      changes do NOT fire it, so a 'Transferred' marker (set on handover) persists
//      until the lead's status next moves — i.e. it is transient by design.
//   4. A one-time backfill of every student.
//
// Guarded (localhost), transactional. `--reset` removes the trigger/functions/lookups
// and resets student_status to 'New'.

require('dotenv').config();
const { Pool } = require('pg');

const ARGS         = process.argv.slice(2);
const RESET        = ARGS.includes('--reset');
const ALLOW_REMOTE = ARGS.includes('--allow-remote');

const STATUSES = [
  { code: 'New',         en: 'New',         vi: 'Mới',        sort: 10 },
  { code: 'In progress', en: 'In progress', vi: 'Đang xử lý', sort: 20 },
  { code: 'Enrolled',    en: 'Enrolled',    vi: 'Đã ghi danh', sort: 30 },
  { code: 'Farming',     en: 'Farming',     vi: 'Chăm sóc',   sort: 40 },
  { code: 'Returning',   en: 'Returning',   vi: 'Quay lại',   sort: 50 },
  { code: 'Transferred', en: 'Transferred', vi: 'Đã chuyển',  sort: 60 },
];

function hostOf(url) { const m = /@([^:@/]+)(?::\d+)?\//.exec(url || ''); return m ? m[1] : '(unparseable)'; }

const FN_DERIVE = `
CREATE OR REPLACE FUNCTION derive_student_status(p_person_id text)
RETURNS text AS $fn$
DECLARE
  v_contracted boolean; v_active boolean; v_new boolean; v_dead boolean; v_total int;
BEGIN
  SELECT
    bool_or(lead_status = 'Contracted'),
    bool_or(lead_status IN ('Engaged','Nurturing','Proposal','Vetted','Family negotiation/review','Met with customer and family')),
    bool_or(COALESCE(NULLIF(btrim(lead_status), ''), 'New') = 'New'),
    bool_or(lead_status IN ('Lost','Not contactable','Archived')),
    count(*)
  INTO v_contracted, v_active, v_new, v_dead, v_total
  FROM leads WHERE person_id = p_person_id;

  IF v_total = 0 OR v_total IS NULL THEN RETURN 'New'; END IF;
  IF v_contracted THEN RETURN 'Enrolled'; END IF;
  IF v_active     THEN RETURN 'In progress'; END IF;
  IF v_new AND v_dead THEN RETURN 'Returning'; END IF;
  IF v_new        THEN RETURN 'New'; END IF;
  RETURN 'Farming';
END;
$fn$ LANGUAGE plpgsql;`;

const FN_TRIGGER = `
CREATE OR REPLACE FUNCTION trg_refresh_student_status()
RETURNS trigger AS $fn$
DECLARE pid text;
BEGIN
  pid := COALESCE(NEW.person_id, OLD.person_id);
  IF pid IS NOT NULL THEN
    UPDATE students SET student_status = derive_student_status(pid), updated_at = NOW()
     WHERE student_id = pid;
  END IF;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;`;

// Handover: primary counsellor changes from one non-empty owner to a DIFFERENT one.
// Marks the student 'Transferred' (transient — the status-refresh trigger re-derives
// it the next time the lead's STATUS moves). The counsellor change itself is audited
// at the app layer, which carries the who/when/from->to record.
const FN_TRANSFER = `
CREATE OR REPLACE FUNCTION trg_mark_transferred()
RETURNS trigger AS $fn$
BEGIN
  IF COALESCE(btrim(OLD.counselor), '') <> ''
     AND COALESCE(btrim(NEW.counselor), '') <> ''
     AND btrim(OLD.counselor) <> btrim(NEW.counselor) THEN
    UPDATE students SET student_status = 'Transferred', updated_at = NOW()
     WHERE student_id = NEW.person_id;
  END IF;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;`;

async function forward(client) {
  // 1. Lookup catalogue (idempotent — no unique constraint, so guard per row).
  for (const s of STATUSES) {
    await client.query(
      `INSERT INTO lookup_values (category, code, label_en, label_vi, sort_order, is_active)
       SELECT 'student_status', $1, $2, $3, $4, true
        WHERE NOT EXISTS (SELECT 1 FROM lookup_values WHERE category = 'student_status' AND code = $1)`,
      [s.code, s.en, s.vi, s.sort]
    );
  }
  console.log(`Lookup: ensured ${STATUSES.length} student_status values.`);

  // 2 + 3. Functions + trigger.
  await client.query(FN_DERIVE);
  await client.query(FN_TRIGGER);
  await client.query(FN_TRANSFER);
  await client.query(`DROP TRIGGER IF EXISTS leads_status_refresh ON leads`);
  await client.query(
    `CREATE TRIGGER leads_status_refresh
     AFTER INSERT OR DELETE OR UPDATE OF lead_status ON leads
     FOR EACH ROW EXECUTE FUNCTION trg_refresh_student_status()`);
  await client.query(`DROP TRIGGER IF EXISTS leads_counselor_transfer ON leads`);
  await client.query(
    `CREATE TRIGGER leads_counselor_transfer
     AFTER UPDATE OF counselor ON leads
     FOR EACH ROW EXECUTE FUNCTION trg_mark_transferred()`);
  console.log('Functions + triggers (status-refresh, counsellor-transfer) installed.');

  // 4. Backfill (every student; none are Transferred yet).
  await client.query(`UPDATE students SET student_status = derive_student_status(student_id)`);
  const dist = (await client.query(
    `SELECT student_status, count(*)::int n FROM students GROUP BY 1 ORDER BY 2 DESC`)).rows;
  console.log('\nDerived student_status distribution:');
  for (const r of dist) console.log(`  ${r.student_status || '(blank)'}: ${r.n}`);
}

async function reset(client) {
  await client.query(`DROP TRIGGER IF EXISTS leads_status_refresh ON leads`);
  await client.query(`DROP TRIGGER IF EXISTS leads_counselor_transfer ON leads`);
  await client.query(`DROP FUNCTION IF EXISTS trg_refresh_student_status()`);
  await client.query(`DROP FUNCTION IF EXISTS trg_mark_transferred()`);
  await client.query(`DROP FUNCTION IF EXISTS derive_student_status(text)`);
  await client.query(`DELETE FROM lookup_values WHERE category = 'student_status'`);
  await client.query(`UPDATE students SET student_status = 'New'`);
  console.log('Removed trigger, functions, lookup rows; reset student_status to New.');
}

async function main() {
  const url = process.env.DATABASE_URL || '';
  const host = hostOf(url);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
  console.log(`Target DB host: ${host} | mode: ${RESET ? 'RESET' : 'FORWARD'}\n`);
  if (!isLocal && !ALLOW_REMOTE) {
    console.error(`ABORT: refuses non-local host "${host}". Point DATABASE_URL at studylink_dev.`);
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (RESET) await reset(client); else await forward(client);
    await client.query('COMMIT');
    console.log('\nCOMMITTED.');
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

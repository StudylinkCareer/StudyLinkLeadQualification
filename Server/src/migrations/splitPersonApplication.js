// server/src/migrations/splitPersonApplication.js
//
// PERSON / APPLICATION restructure — STEP 1 (schema + data split).
//
// Turns the single `students` table (which today conflates a person and their
// one engagement) into:
//     students      = the PERSON   (identity, family, OCEAN, photo)
//     applications  = the ENGAGEMENT/contract (status, counsellors, tier, risk,
//                     dates, the ask, source/marketing, per-engagement notes)
// linked by applications.person_id -> students.unique_id.
//
// Each existing students row (currently 1:1) becomes ONE person (the row stays)
// + ONE application (new row carrying the engagement fields).
//
// CHILD TABLES
//   student_notes  -> application   (add application_id, backfill all)
//   documents      -> application   (add application_id, backfill all)
//   audit_log      -> SPLIT: status/engagement field changes get application_id;
//                    identity-field changes stay person-level (application_id NULL,
//                    still referenced by student_id = person)
//   event_attendees, lead_events -> PERSON: already key on the person row
//                    (student_unique_id / student_id), so NO change needed.
//
// SAFETY
//   * ADDITIVE ONLY — creates `applications` and adds `application_id` columns.
//     Drops nothing. `students` keeps its engagement columns (vestigial) until a
//     later, separate "contract" migration. Fully reversible via --reset.
//   * DEV GUARD — aborts unless DATABASE_URL host is localhost, unless you pass
//     --allow-remote. This restructure must be proven on the dev sandbox first.
//
// USAGE (from the Server/ directory, with DATABASE_URL pointing at studylink_dev):
//   node src/migrations/splitPersonApplication.js            # run the split
//   node src/migrations/splitPersonApplication.js --reset    # undo, then re-run clean
//
// Re-runnable: with --reset it first removes applications + the added columns so
// you can iterate freely in dev.

require('dotenv').config();
const { Pool } = require('pg');

const ARGS        = process.argv.slice(2);
const RESET       = ARGS.includes('--reset');
const ALLOW_REMOTE = ARGS.includes('--allow-remote');

// ── Engagement (application-level) columns, copied from students ──────────────
const APP_COLS = [
  'study_plans', 'lead_source', 'interaction', 'destination_country', 'timeline',
  'process_application', 'school_event', 'budget', 'scholarship_demand', 'english_level',
  'gpa', 'immigration_history', 'sponsor_income', 'income_evidence', 'study_plan_gap',
  'ultimate_objective', 'risk_score', 'stone_tier', 'qr_code_image_url',
  'counseling_notes', 'case_officer_notes', 'management_notes',
  'status', 'counselor', 'senior_counselor', 'presales', 'marketing_staff',
  'lead_status', 'close_date', 'confidence',
  'campaign_type', 'campaign_name', 'campaign_start', 'campaign_end', 'referral_source',
  'mkt_channel', 'mkt_attendance', 'mkt_type', 'mkt_contact_name', 'mkt_subagent',
  'major', 'school_attended', 'sl_heard_type', 'sl_channel', 'sl_referral_kind',
  'sl_referral_who', 'database_source', 'source', 'source_detail', 'source_unverified',
  'office', 'distribution_status', 'prev_counselor',
];

// ── Identity (person-level) audit field_names (camelCase, as audit_log stores) ─
// audit_log rows about these stay person-level (application_id left NULL).
// Everything else is treated as engagement and gets an application_id.
const IDENTITY_FIELDS = [
  'fullName', 'email', 'phone',
  'contactMedium1', 'contactDetail1', 'phoneCountryCode1',
  'contactMedium2', 'contactDetail2', 'phoneCountryCode2',
  'hiddenPhoneCountryCode', 'residency', 'yearOfBirth', 'ward', 'headshotUrl',
  'preferredSocial', 'socialConsent',
  'motherEmail', 'motherFullName', 'motherPhoneCountryCode', 'motherPhone',
  'motherContactMedium', 'motherContactCc', 'motherContactDetail',
  'fatherEmail', 'fatherFullName', 'fatherPhoneCountryCode', 'fatherPhone',
  'fatherContactMedium', 'fatherContactCc', 'fatherContactDetail',
  'oceanExtraversion', 'oceanAgreeableness', 'oceanConscientiousness',
  'oceanNeuroticism', 'oceanOpenness', 'oceanArchetype', 'oceanNarrative',
  ...Array.from({ length: 15 }, (_, i) => `oceanQ${i + 1}`),
];

function hostOf(url) {
  const m = /@([^:@/]+)(?::\d+)?\//.exec(url || '');
  return m ? m[1] : '(unparseable)';
}

async function main() {
  const url  = process.env.DATABASE_URL || '';
  const host = hostOf(url);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);

  console.log(`Target DB host: ${host}`);
  if (!isLocal && !ALLOW_REMOTE) {
    console.error(
      `\nABORT: this restructure refuses to run against a non-local host ("${host}").\n` +
      `Point DATABASE_URL at studylink_dev (localhost). To override (NOT advised), pass --allow-remote.`
    );
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── RESET: undo a previous run so dev can iterate cleanly ────────────────
    if (RESET) {
      console.log('--reset: removing applications + added columns…');
      await client.query(`ALTER TABLE IF EXISTS student_notes DROP COLUMN IF EXISTS application_id`);
      await client.query(`ALTER TABLE IF EXISTS documents     DROP COLUMN IF EXISTS application_id`);
      await client.query(`ALTER TABLE IF EXISTS audit_log     DROP COLUMN IF EXISTS application_id`);
      await client.query(`DROP TABLE IF EXISTS applications CASCADE`);
    }

    // Guard against double-create.
    const exists = await client.query(`SELECT to_regclass('public.applications') AS t`);
    if (exists.rows[0].t) {
      throw new Error('applications table already exists. Re-run with --reset to rebuild.');
    }

    // ── 1. Create applications structure from students' engagement columns ───
    //    WHERE false copies column names + exact types, no data, no constraints.
    const appColList = APP_COLS.join(', ');
    await client.query(
      `CREATE TABLE applications AS
         SELECT unique_id AS person_id, ${appColList}
           FROM students WHERE false`
    );
    await client.query(`ALTER TABLE applications ADD COLUMN application_id SERIAL PRIMARY KEY`);
    await client.query(`ALTER TABLE applications ALTER COLUMN person_id SET NOT NULL`);
    await client.query(
      `ALTER TABLE applications
         ADD CONSTRAINT applications_person_fk
         FOREIGN KEY (person_id) REFERENCES students(unique_id) ON DELETE CASCADE`
    );
    await client.query(`ALTER TABLE applications ADD COLUMN created_at timestamp DEFAULT now()`);
    await client.query(`ALTER TABLE applications ADD COLUMN updated_at timestamp DEFAULT now()`);

    // ── 2. One application per existing student (carry their timestamps) ─────
    await client.query(
      `INSERT INTO applications (person_id, ${appColList}, created_at, updated_at)
         SELECT unique_id, ${appColList}, created_at, updated_at
           FROM students`
    );
    await client.query(`CREATE INDEX idx_applications_person  ON applications (person_id)`);
    await client.query(`CREATE INDEX idx_applications_status  ON applications (lead_status)`);

    // ── 3. Re-point child tables ─────────────────────────────────────────────
    // student_notes -> application (all rows)
    await client.query(`ALTER TABLE student_notes ADD COLUMN application_id integer`);
    await client.query(
      `UPDATE student_notes sn SET application_id = a.application_id
         FROM applications a WHERE a.person_id = sn.student_id`
    );
    await client.query(
      `ALTER TABLE student_notes
         ADD CONSTRAINT student_notes_application_fk
         FOREIGN KEY (application_id) REFERENCES applications(application_id) ON DELETE CASCADE`
    );
    await client.query(`CREATE INDEX idx_student_notes_application ON student_notes (application_id)`);

    // documents -> application (all rows)
    await client.query(`ALTER TABLE documents ADD COLUMN application_id integer`);
    await client.query(
      `UPDATE documents d SET application_id = a.application_id
         FROM applications a WHERE a.person_id = d.student_id`
    );
    await client.query(
      `ALTER TABLE documents
         ADD CONSTRAINT documents_application_fk
         FOREIGN KEY (application_id) REFERENCES applications(application_id) ON DELETE CASCADE`
    );
    await client.query(`CREATE INDEX idx_documents_application ON documents (application_id)`);

    // audit_log -> SPLIT: engagement fields get application_id; identity fields stay person-level
    await client.query(`ALTER TABLE audit_log ADD COLUMN application_id integer`);
    await client.query(
      `UPDATE audit_log al SET application_id = a.application_id
         FROM applications a
        WHERE a.person_id = al.student_id
          AND NOT (al.field_name = ANY($1))`,
      [IDENTITY_FIELDS]
    );
    await client.query(
      `ALTER TABLE audit_log
         ADD CONSTRAINT audit_log_application_fk
         FOREIGN KEY (application_id) REFERENCES applications(application_id) ON DELETE CASCADE`
    );
    await client.query(`CREATE INDEX idx_audit_application ON audit_log (application_id)`);

    // ── 4. Verify before commit ──────────────────────────────────────────────
    const q = async (sql, p) => (await client.query(sql, p)).rows[0];
    const persons  = (await q(`SELECT count(*)::int n FROM students`)).n;
    const apps     = (await q(`SELECT count(*)::int n FROM applications`)).n;
    const notesTot = (await q(`SELECT count(*)::int n FROM student_notes`)).n;
    const notesMap = (await q(`SELECT count(*)::int n FROM student_notes WHERE application_id IS NOT NULL`)).n;
    const docsTot  = (await q(`SELECT count(*)::int n FROM documents`)).n;
    const docsMap  = (await q(`SELECT count(*)::int n FROM documents WHERE application_id IS NOT NULL`)).n;
    const auditApp = (await q(`SELECT count(*)::int n FROM audit_log WHERE application_id IS NOT NULL`)).n;
    const auditPer = (await q(`SELECT count(*)::int n FROM audit_log WHERE application_id IS NULL`)).n;
    const orphanN  = (await q(`SELECT count(*)::int n FROM student_notes WHERE application_id IS NULL`)).n;
    const orphanD  = (await q(`SELECT count(*)::int n FROM documents     WHERE application_id IS NULL`)).n;

    console.log('\n── Verification ───────────────────────────────');
    console.log(`persons (students)        : ${persons}`);
    console.log(`applications created      : ${apps}   ${apps === persons ? 'OK (1 per person)' : 'MISMATCH!'}`);
    console.log(`student_notes mapped      : ${notesMap}/${notesTot}   ${orphanN === 0 ? 'OK' : `(${orphanN} unmapped!)`}`);
    console.log(`documents mapped          : ${docsMap}/${docsTot}   ${orphanD === 0 ? 'OK' : `(${orphanD} unmapped!)`}`);
    console.log(`audit_log -> application  : ${auditApp}  (engagement-field changes)`);
    console.log(`audit_log -> person only  : ${auditPer}  (identity-field changes, application_id NULL)`);

    const ok = apps === persons && orphanN === 0 && orphanD === 0;
    if (!ok) {
      throw new Error('Verification failed (see MISMATCH/unmapped above) — rolling back.');
    }

    await client.query('COMMIT');
    console.log('\nCOMMITTED. Person/application split complete on this database.');
    console.log('students keeps its engagement columns (vestigial) until the later contract step.');
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

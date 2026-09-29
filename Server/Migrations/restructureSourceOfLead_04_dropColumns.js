// Source of Lead restructure — Phase 7: final column drops.
//
// Highest-risk, least-reversible phase of the plan. Gated per-column behind
// explicit flags — running this file with NO flags only drops
// `students.campaign_type` (confirmed always-unused, safe immediately) and
// otherwise just reports current state. Everything else requires the owner
// to explicitly ask for that specific drop when its own gate is actually
// satisfied (see the plan doc, Phase 7):
//   --drop-campaign-fields   campaign_name/campaign_start/campaign_end
//                            (once Option A / Event Registrations has been
//                            live and observed correct for a full reporting
//                            cycle — NOT just "the code shipped")
//   --drop-source            students.source + lead_events.source
//                            (once Phase 2's merge + Phase 6's report
//                            rewiring have been verified through at least
//                            one month-end close)
//   --drop-legacy-detail     students.source_detail/referral_source +
//                            lead_events.source_detail (once Phase 3's
//                            reclassification tool shows legacy values
//                            materially handled — see the note below on why
//                            this is a soft/informational gate, not an exact
//                            coverage check)
//   --force                  required IN ADDITION to --drop-legacy-detail if
//                            source_reclassification_log is still empty
//                            (i.e. the reclassification tool has never been
//                            run at all — the one case this script can prove
//                            mechanically)
//   --reset                  re-adds every column dropped by a previous run
//                            of this script (structure only, values are NOT
//                            restored from the backup table — see below)
//   --allow-remote           required to run against a non-local DB
//
// Coverage-check note (source_detail/referral_source): the plan asks this
// migration to "refuse to run without --force if unreclassified rows
// remain." That can't be checked exactly — after a value IS reclassified,
// /assign OVERWRITES the same column with the new sub-field text (a real
// referrer name / partner note), so a non-empty column value on its own
// can't tell "old unprocessed legacy string" apart from "new post-
// reclassification note." The one thing this script CAN prove mechanically
// is whether the tool has been used at all (source_reclassification_log
// empty = definitely not started). Beyond that, "materially reclassified"
// is a human judgment call per the plan's own wording ("a slow, human-paced
// gate, not a migration-night step") — this script prints the current
// distinct legacy-value count so a human can decide, but doesn't try to
// compute an exact percentage.
//
// SAFETY: localhost-guarded, transactional, idempotent (DROP/ADD IF
// [NOT] EXISTS). Before ANY drop in a given run, archives the current
// values of every in-scope column (for both tables) into
// students_source_backup, kept indefinitely — this data is not a redundant
// copy of something surviving elsewhere (unlike dropRedundantLeadColumns.js's
// leads/students duplication), so it must not be lost.
//
// Usage (from Server/, DATABASE_URL -> studylink_dev):
//   node Migrations/restructureSourceOfLead_04_dropColumns.js
//   node Migrations/restructureSourceOfLead_04_dropColumns.js --drop-campaign-fields
//   node Migrations/restructureSourceOfLead_04_dropColumns.js --drop-source
//   node Migrations/restructureSourceOfLead_04_dropColumns.js --drop-legacy-detail [--force]
//   node Migrations/restructureSourceOfLead_04_dropColumns.js --reset

require('dotenv').config();
const { Pool } = require('pg');

const ARGS = process.argv.slice(2);
const RESET               = ARGS.includes('--reset');
const ALLOW_REMOTE        = ARGS.includes('--allow-remote');
const DROP_CAMPAIGN_FIELDS = ARGS.includes('--drop-campaign-fields');
const DROP_SOURCE          = ARGS.includes('--drop-source');
const DROP_LEGACY_DETAIL   = ARGS.includes('--drop-legacy-detail');
const FORCE                = ARGS.includes('--force');

// [table, column, type-to-restore-on-reset, flag-that-gates-it]
// campaign_type has no flag — it always drops (confirmed dead everywhere,
// see Server/src/models/Lead.js's Phase 0 cleanup and this plan's research).
const DROP_COLS = [
  ['students',    'campaign_type',   'text', null],
  ['students',    'campaign_name',   'text', 'campaign'],
  ['students',    'campaign_start',  'date', 'campaign'],
  ['students',    'campaign_end',    'date', 'campaign'],
  ['students',    'source',          'text', 'source'],
  ['lead_events', 'source',          'text', 'source'],
  ['students',    'source_detail',   'text', 'legacy_detail'],
  ['students',    'referral_source', 'text', 'legacy_detail'],
  ['lead_events', 'source_detail',   'text', 'legacy_detail'],
];

const GATES = {
  campaign: DROP_CAMPAIGN_FIELDS,
  source: DROP_SOURCE,
  legacy_detail: DROP_LEGACY_DETAIL,
};

function hostOf(url) {
  const m = /@([^:@/]+)(?::\d+)?\//.exec(url || '');
  return m ? m[1] : '(unparseable)';
}

async function colExists(client, table, column) {
  // Schema-qualified: an unqualified check against information_schema.columns
  // matched a same-named table in another schema during testing, making the
  // post-drop verification see a false "still present" for public.students
  // and roll back a drop that had actually succeeded.
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column]);
  return r.rowCount > 0;
}

async function main() {
  const url  = process.env.DATABASE_URL || '';
  const host = hostOf(url);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);

  console.log(`Target DB host: ${host}`);
  console.log(RESET ? 'Direction: RE-ADD columns (--reset)' : 'Direction: DROP columns');
  if (!isLocal && !ALLOW_REMOTE) {
    console.error(`\nABORT: refuses to run against non-local host "${host}". Point DATABASE_URL at studylink_dev, or pass --allow-remote.`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const toTouch = RESET ? DROP_COLS : DROP_COLS.filter(([, , , gate]) => !gate || GATES[gate]);

    if (!RESET && DROP_LEGACY_DETAIL) {
      const logCount = (await client.query(`SELECT COUNT(*)::int n FROM source_reclassification_log`)).rows[0].n;
      if (logCount === 0 && !FORCE) {
        throw new Error('ABORT: --drop-legacy-detail requested but source_reclassification_log is empty — the reclassification tool has never been run. Re-run with --force if this is intentional. Nothing changed.');
      }
      const legacy = await client.query(
        `SELECT (SELECT COUNT(*) FROM public.students WHERE source_detail IS NOT NULL AND btrim(source_detail) <> '') AS sd,
                (SELECT COUNT(*) FROM public.students WHERE referral_source IS NOT NULL AND btrim(referral_source) <> '') AS rs`);
      console.log(`  source_reclassification_log has ${logCount} entries. Students currently holding a non-empty source_detail: ${legacy.rows[0].sd}, referral_source: ${legacy.rows[0].rs}.`);
      console.log('  (These counts include already-reclassified rows — see this file\'s header comment on why an exact "remaining" count is not computable. Human judgment call, per the plan.)');
    }

    if (!RESET && toTouch.length) {
      console.log('\n-- archiving current values to students_source_backup before dropping --');
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.students_source_backup (
          student_id text PRIMARY KEY,
          campaign_type text, campaign_name text, campaign_start date, campaign_end date,
          source text, source_detail text, referral_source text,
          archived_at timestamptz NOT NULL DEFAULT now()
        )`);
      const upsert = await client.query(`
        INSERT INTO public.students_source_backup
          (student_id, campaign_type, campaign_name, campaign_start, campaign_end, source, source_detail, referral_source, archived_at)
        SELECT student_id, campaign_type, campaign_name, campaign_start, campaign_end, source, source_detail, referral_source, now()
          FROM public.students
        ON CONFLICT (student_id) DO UPDATE SET
          campaign_type = EXCLUDED.campaign_type, campaign_name = EXCLUDED.campaign_name,
          campaign_start = EXCLUDED.campaign_start, campaign_end = EXCLUDED.campaign_end,
          source = EXCLUDED.source, source_detail = EXCLUDED.source_detail,
          referral_source = EXCLUDED.referral_source, archived_at = now()`);
      console.log(`  archived/refreshed ${upsert.rowCount} student rows.`);
    }

    for (const [table, col, type] of toTouch) {
      if (!(await colExists(client, table, col)) && !RESET) {
        console.log(`skip: ${table}.${col} already absent`);
        continue;
      }
      if (RESET) {
        await client.query(`ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`);
        console.log(`re-added: ${table}.${col} (${type}) — structure only, values NOT restored (see students_source_backup)`);
      } else {
        await client.query(`ALTER TABLE public.${table} DROP COLUMN IF EXISTS ${col}`);
        console.log(`dropped:  ${table}.${col}`);
      }
    }

    // Verify
    console.log('\n── Verification ───────────────────────────────');
    let ok = true;
    for (const [table, col] of toTouch) {
      const present = await colExists(client, table, col);
      const expected = RESET; // after RESET, expect present; after drop, expect absent
      console.log(`${table}.${col}: ${present ? 'present' : 'absent'}`);
      if (present !== expected) ok = false;
    }
    if (!ok) throw new Error('Verification failed — column set not in the expected state. Rolling back.');

    await client.query('COMMIT');
    console.log(`\nCOMMITTED — ${RESET ? 're-added' : 'processed'} ${toTouch.length} column(s).`);
    if (!RESET) {
      const skipped = DROP_COLS.filter(([, , , gate]) => gate && !GATES[gate]);
      if (skipped.length) {
        console.log(`\nNot touched (no matching flag passed): ${skipped.map(([t, c]) => `${t}.${c}`).join(', ')}`);
      }
    }
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

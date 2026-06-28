// server/src/migrations/dropRedundantLeadColumns.js
//
// CLEANUP — drop the Self-Assessment + Source/Marketing columns from `leads`.
// These are now STUDENT-level only (they live on `students` and are shown/edited
// on the Student Detail screen); their copies on `leads` are dead weight and the
// Lead Detail screen never references them.
//
// Dropped (19): the Self-Assessment block + the Source/Marketing fields.
// NOT touched: ambiguous columns whose home isn't settled yet (mkt_*, sl_*,
// interaction, school_event, school_attended, *_notes, status, database_source,
// source_unverified, qr_code_image_url) — left in place intentionally.
//
// SAFETY: localhost-guarded, transactional, idempotent (DROP/ADD IF [NOT] EXISTS).
//   --reset RE-ADDS the columns (structure only — the dropped values were a
//   redundant copy of the student's data, so nothing unique is lost).
//
// USAGE (from Server/, DATABASE_URL -> studylink_dev):
//   node src/migrations/dropRedundantLeadColumns.js            # drop them
//   node src/migrations/dropRedundantLeadColumns.js --reset    # re-add (empty)

require('dotenv').config();
const { Pool } = require('pg');

const ARGS         = process.argv.slice(2);
const RESET        = ARGS.includes('--reset');
const ALLOW_REMOTE = ARGS.includes('--allow-remote');

// [column, type-to-restore-on-reset]
const DROP_COLS = [
  // Self Assessment (now Student-level)
  ['stone_tier', 'text'], ['risk_score', 'text'], ['gpa', 'text'], ['english_level', 'text'],
  ['budget', 'text'], ['scholarship_demand', 'text'], ['sponsor_income', 'text'], ['income_evidence', 'text'],
  ['immigration_history', 'text'], ['study_plan_gap', 'text'], ['ultimate_objective', 'text'],
  // Source & Marketing (now Student-level)
  ['lead_source', 'text'], ['source', 'text'], ['source_detail', 'text'], ['referral_source', 'text'],
  ['campaign_type', 'text'], ['campaign_name', 'text'], ['campaign_start', 'date'], ['campaign_end', 'date'],
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
  console.log(`Direction: ${RESET ? 'RE-ADD columns (--reset)' : 'DROP columns'}`);
  if (!isLocal && !ALLOW_REMOTE) {
    console.error(`\nABORT: refuses to run against non-local host "${host}". Point DATABASE_URL at studylink_dev.`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!(await client.query(`SELECT to_regclass('public.leads') AS t`)).rows[0].t) {
      throw new Error('Table "leads" does not exist — run renameApplicationsToLeads.js first.');
    }

    for (const [col, type] of DROP_COLS) {
      if (RESET) {
        await client.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS ${col} ${type}`);
        console.log(`re-added: leads.${col} (${type})`);
      } else {
        await client.query(`ALTER TABLE leads DROP COLUMN IF EXISTS ${col}`);
        console.log(`dropped:  leads.${col}`);
      }
    }

    // Verify
    const names = DROP_COLS.map(c => c[0]);
    const present = (await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'leads' AND column_name = ANY($1)`, [names]
    )).rows.map(r => r.column_name);

    console.log('\n── Verification ───────────────────────────────');
    console.log(`columns from the set still on leads: ${present.length}` + (present.length ? ` (${present.join(', ')})` : ''));
    const ok = RESET ? present.length === names.length : present.length === 0;
    if (!ok) throw new Error('Verification failed — column set not in the expected state. Rolling back.');

    await client.query('COMMIT');
    console.log(`\nCOMMITTED — ${RESET ? 're-added' : 'dropped'} ${names.length} columns on leads.`);
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

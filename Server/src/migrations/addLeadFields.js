// server/src/migrations/addLeadFields.js
//
// Additive: four new OPTIONAL (nullable) columns on `leads` that distinguish one
// lead from another for the same student, plus a free-text rationale:
//   intake              — the intended intake (e.g. "2026 Fall")
//   degree_level        — Bachelor / Masters / PhD ...
//   target_institution  — the institution this lead targets (the field that
//                         distinguishes the parallel "two institutions, same
//                         intake" case that triggered this work)
//   rationale           — free-text note on why this (extra) lead exists
//
// All nullable — none is required (parallel leads share intake/degree and differ
// only on institution; sequential leads differ on intake/degree).
//
// SAFETY: localhost-guarded, transaction-wrapped, idempotent (ADD COLUMN IF NOT
// EXISTS), reversible (--reset drops the four columns).
//
// USAGE (from Server/, DATABASE_URL -> studylink_dev):
//   node src/migrations/addLeadFields.js            # add the columns
//   node src/migrations/addLeadFields.js --reset    # drop them again

require('dotenv').config();
const { Pool } = require('pg');

const ARGS         = process.argv.slice(2);
const RESET        = ARGS.includes('--reset');
const ALLOW_REMOTE = ARGS.includes('--allow-remote');

const NEW_COLS = ['intake', 'degree_level', 'target_institution', 'rationale'];

function hostOf(url) {
  const m = /@([^:@/]+)(?::\d+)?\//.exec(url || '');
  return m ? m[1] : '(unparseable)';
}

async function main() {
  const url  = process.env.DATABASE_URL || '';
  const host = hostOf(url);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);

  console.log(`Target DB host: ${host}`);
  console.log(`Direction: ${RESET ? 'DROP columns (--reset)' : 'ADD columns'}`);
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

    for (const col of NEW_COLS) {
      if (RESET) {
        await client.query(`ALTER TABLE leads DROP COLUMN IF EXISTS ${col}`);
        console.log(`dropped: leads.${col}`);
      } else {
        await client.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS ${col} text`);
        console.log(`added:   leads.${col} (text, nullable)`);
      }
    }

    // Verify
    const present = (await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'leads' AND column_name = ANY($1)`, [NEW_COLS]
    )).rows.map(r => r.column_name);

    console.log('\n── Verification ───────────────────────────────');
    for (const col of NEW_COLS) {
      const here = present.includes(col);
      console.log(`leads.${col.padEnd(20)} : ${here ? 'present' : 'absent'}`);
    }
    const ok = RESET ? present.length === 0 : present.length === NEW_COLS.length;
    if (!ok) throw new Error('Verification failed — column set not in the expected state. Rolling back.');

    await client.query('COMMIT');
    console.log(`\nCOMMITTED — ${RESET ? 'dropped' : 'added'} ${NEW_COLS.length} columns on leads.`);
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

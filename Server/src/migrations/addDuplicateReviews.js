// server/src/migrations/addDuplicateReviews.js
//
// "Duplicates to review" — backing table for the duplicate checker. When a
// Distribution upload row's email/phone matches an EXISTING person, we don't
// silently create a second person; we park the incoming row here for a human to
// resolve (link as a new lead for the existing person / create as a separate
// person / dismiss).
//
// Guarded (localhost), transactional. `--reset` drops the table.

require('dotenv').config();
const { Pool } = require('pg');

const ARGS         = process.argv.slice(2);
const RESET        = ARGS.includes('--reset');
const ALLOW_REMOTE = ARGS.includes('--allow-remote');

function hostOf(url) { const m = /@([^:@/]+)(?::\d+)?\//.exec(url || ''); return m ? m[1] : '(unparseable)'; }

const CREATE = `
CREATE TABLE IF NOT EXISTS duplicate_reviews (
  id            serial PRIMARY KEY,
  incoming_uid  text,
  email         text,
  phone         text,
  match_type    text,                                  -- 'email' | 'phone' | 'email+phone'
  matched_ids   text[]        NOT NULL DEFAULT '{}',   -- existing student_id(s) the row collided with
  payload       jsonb         NOT NULL,                -- the full normalized upload row
  office        text,                                  -- upload's office default at ingest time
  status        text          NOT NULL DEFAULT 'pending',  -- pending | resolved | dismissed
  resolution    text,                                  -- 'linked' | 'new_person' | 'dismissed'
  created_lead_id  integer,                            -- set when resolved into a lead
  created_at    timestamptz   NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolved_by   text
);`;

async function forward(client) {
  await client.query(CREATE);
  await client.query(`CREATE INDEX IF NOT EXISTS duplicate_reviews_status_idx ON duplicate_reviews (status, created_at DESC)`);
  // Speeds up the per-row email/phone collision lookup during upload.
  await client.query(`CREATE INDEX IF NOT EXISTS students_email_lower_idx ON students (LOWER(email)) WHERE email IS NOT NULL AND email <> ''`);
  await client.query(`CREATE INDEX IF NOT EXISTS students_phone_idx        ON students (phone)        WHERE phone IS NOT NULL AND phone <> ''`);
  const n = (await client.query(`SELECT count(*)::int n FROM duplicate_reviews`)).rows[0].n;
  console.log(`duplicate_reviews ready (existing rows: ${n}). Lookup indexes ensured.`);
}

async function reset(client) {
  await client.query(`DROP TABLE IF EXISTS duplicate_reviews`);
  await client.query(`DROP INDEX IF EXISTS students_email_lower_idx`);
  await client.query(`DROP INDEX IF EXISTS students_phone_idx`);
  console.log('Dropped duplicate_reviews + lookup indexes.');
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

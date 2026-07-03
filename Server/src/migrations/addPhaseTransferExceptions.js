// Server/src/migrations/addPhaseTransferExceptions.js
// ---------------------------------------------------------------------------
// Exception log for phase-transfer guardrails. When a BATCH path (upload /
// redistribution) would move an Order along a route the phase_transitions matrix
// does not allow, the transfer is BLOCKED (skipped) and recorded here for
// post-processing, instead of derailing the whole run.
//
// Non-destructive: CREATE TABLE IF NOT EXISTS. Idempotent.
//   node src/migrations/addPhaseTransferExceptions.js                 # dev
//   node src/migrations/addPhaseTransferExceptions.js --allow-remote  # PROD
//   node src/migrations/addPhaseTransferExceptions.js --reset         # drop table
// ---------------------------------------------------------------------------
require('dotenv').config();
const { Pool } = require('pg');

const ARGS = process.argv.slice(2);
const RESET = ARGS.includes('--reset');
const ALLOW_REMOTE = ARGS.includes('--allow-remote');
const url = process.env.DATABASE_URL || '';
const host = (url.match(/@([^:@/]+)/) || [])[1] || '(?)';
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);

if (!isLocal && !ALLOW_REMOTE) {
  console.error(`ABORT: non-local host "${host}". Use --allow-remote for a deliberate PROD run.`);
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (RESET) {
      await client.query(`DROP TABLE IF EXISTS phase_transfer_exceptions`);
      console.log('dropped phase_transfer_exceptions');
    } else {
      await client.query(`
        CREATE TABLE IF NOT EXISTS phase_transfer_exceptions (
          id              BIGSERIAL PRIMARY KEY,
          student_id      text NOT NULL,
          lead_id         bigint,
          from_phase      text,
          to_phase        text,
          attempted_owner text,
          source          text,               -- 'upload' | 'distribution' | 'assign_manual'
          reason          text,
          batch_id        text,
          resolved        boolean NOT NULL DEFAULT false,
          created_at      timestamptz NOT NULL DEFAULT NOW()
        )`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_pte_unresolved ON phase_transfer_exceptions (resolved, created_at DESC)`);
      console.log('ensured phase_transfer_exceptions (+ index)');
    }
    await client.query('COMMIT');
    console.log(`✓ COMMITTED on ${host}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('✗ rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();

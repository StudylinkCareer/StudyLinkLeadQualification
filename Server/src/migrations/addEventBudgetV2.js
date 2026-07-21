// V2 of the event budget schema (LM console -> Report -> Event Report):
//   - event_budget_items.budget_type ('planned' | 'actual') - lets the ledger
//     hold both the pre-event "Kế hoạch" plan and post-event real spend
//     separately, so Total Cost can be shown as two computed sums instead of
//     one manually-typed figure.
//   - events.total_cost DROPPED - superseded by SUM(event_budget_items.amount)
//     per budget_type, computed on read. Safe to drop outright: this column
//     was added earlier this same session and never shipped to production or
//     held real data.
//   - events.khach_k_count - manual headcount of non-lead guests (club
//     members, performers, etc. who never fill out the LQ form, so there's no
//     pipeline that could populate this automatically). NULL = unknown/not
//     yet entered, deliberately not defaulted to 0.
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addEventBudgetV2.js
//   PROD: node src/migrations/addEventBudgetV2.js --allow-remote
require('dotenv').config();
const { Pool } = require('pg');

const url  = process.env.DATABASE_URL || '';
const host = (url.split('@')[1] || '').split('/')[0] || '(unknown)';
const isLocal     = /localhost|127\.0\.0\.1|studylink_dev/.test(url);
const allowRemote = process.argv.includes('--allow-remote');

if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!isLocal && !allowRemote) {
  console.error(`Refusing to run against non-local DB (${host}) without --allow-remote`);
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

(async () => {
  console.log('Target DB host: ' + host);

  await pool.query(`ALTER TABLE event_budget_items
      ADD COLUMN IF NOT EXISTS budget_type text NOT NULL DEFAULT 'actual'`);

  await pool.query(`ALTER TABLE events DROP COLUMN IF EXISTS total_cost`);

  await pool.query(`ALTER TABLE events
      ADD COLUMN IF NOT EXISTS khach_k_count integer`);

  const check = await pool.query(`
    SELECT (SELECT column_name FROM information_schema.columns
             WHERE table_name='event_budget_items' AND column_name='budget_type') AS budget_type_col,
           (SELECT column_name FROM information_schema.columns
             WHERE table_name='events' AND column_name='total_cost') AS total_cost_col_should_be_null,
           (SELECT column_name FROM information_schema.columns
             WHERE table_name='events' AND column_name='khach_k_count') AS khach_k_count_col
  `);
  console.log(check.rows[0]);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

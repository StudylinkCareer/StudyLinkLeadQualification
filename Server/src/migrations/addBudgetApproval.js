// Mom's budget-approval workflow (Event Report -> Budget):
//   - event_budget_items.approval_note(_by/_at) - a per-line-item comment
//     only her account can write (enforced in the route layer, not here),
//     for questioning/disputing/reminding staff about a specific expense.
//   - events.budget_{planned,actual}_approved_(at/by) - two independent
//     "Duyệt" sign-off stamps (Planned and Actual approve separately,
//     matching the existing budget_type split on event_budget_items).
//     No lock semantics: re-approving just re-stamps these columns.
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addBudgetApproval.js
//   PROD: node src/migrations/addBudgetApproval.js --allow-remote
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
      ADD COLUMN IF NOT EXISTS approval_note text,
      ADD COLUMN IF NOT EXISTS approval_note_by text,
      ADD COLUMN IF NOT EXISTS approval_note_at timestamptz`);

  await pool.query(`ALTER TABLE events
      ADD COLUMN IF NOT EXISTS budget_planned_approved_at timestamptz,
      ADD COLUMN IF NOT EXISTS budget_planned_approved_by text,
      ADD COLUMN IF NOT EXISTS budget_actual_approved_at timestamptz,
      ADD COLUMN IF NOT EXISTS budget_actual_approved_by text`);

  const check = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='event_budget_items' AND column_name IN ('approval_note','approval_note_by','approval_note_at')) AS item_cols,
      (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='events' AND column_name IN ('budget_planned_approved_at','budget_planned_approved_by','budget_actual_approved_at','budget_actual_approved_by')) AS event_cols
  `);
  console.log('Expect item_cols=3, event_cols=4:', check.rows[0]);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

// Budget/CPL schema for the new Event Report page (LM console -> Report ->
// Event Report). Three pieces:
//   - events.total_cost / events.total_sponsorship: the two top-line figures
//     from the event's budget plan ("TỔNG CỘNG CHI PHÍ" / "TỔNG TIỀN TÀI TRỢ").
//     The 85%-of-sponsorship and remaining-money figures are pure derivations
//     of these two and are computed on read, never stored.
//   - event_budget_items: the line-item budget ledger (category/line item/
//     unit/unit price/quantity/amount/note), one row per line in the budget
//     planning doc.
//   - event_source_spend: manual, editable per-lead-source spend figures, used
//     to compute per-row CPL in the source breakdown table. Deliberately NOT
//     auto-mapped from event_budget_items - budget line items are organized by
//     campaign/vendor, lead sources are organized by channel/staff/partner/
//     school; there's no clean automatic join between the two taxonomies.
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addEventBudgetSchema.js
//   PROD: node src/migrations/addEventBudgetSchema.js --allow-remote
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

  await pool.query(`ALTER TABLE events
      ADD COLUMN IF NOT EXISTS total_cost numeric,
      ADD COLUMN IF NOT EXISTS total_sponsorship numeric`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_budget_items (
      id          serial PRIMARY KEY,
      event_id    integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      category    text NOT NULL,
      line_item   text NOT NULL,
      unit        text,
      unit_price  numeric,
      quantity    numeric,
      amount      numeric NOT NULL,
      note        text,
      created_at  timestamptz DEFAULT now(),
      updated_at  timestamptz DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_event_budget_items_event ON event_budget_items(event_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_source_spend (
      event_id     integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      source_label text NOT NULL,
      spend_amount numeric,
      updated_by   text,
      updated_at   timestamptz DEFAULT now(),
      PRIMARY KEY (event_id, source_label)
    )
  `);

  const check = await pool.query(`
    SELECT to_regclass('public.event_budget_items') AS budget_items,
           to_regclass('public.event_source_spend') AS source_spend,
           (SELECT column_name FROM information_schema.columns
             WHERE table_name='events' AND column_name='total_cost') AS total_cost_col,
           (SELECT column_name FROM information_schema.columns
             WHERE table_name='events' AND column_name='total_sponsorship') AS total_sponsorship_col
  `);
  console.log(check.rows[0]);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

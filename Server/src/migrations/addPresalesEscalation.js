// Pre-sales internal Uncontactable escalation chain (confirmed 2026-08).
//
// Extends the existing Sales -> Pre-sales auto-transfer
// (addUncontactableTransfer.js) with two more hops, all sharing the same
// round-robin roster, audit table, and slot-based qualification idea:
//
//   Presales #1 logs KBM calls covering all 3 of THEIR OWN "khung giờ"
//   (see below — not everyone's 3 slots mean the same thing) -> lead
//   hands to Presales #2, status flips back to 'New'.
//
//   Presales #2 does the same -> lead escalates to the existing "Pool"
//   holding state (students.order_phase='Pool' + an order_assignments row
//   for position 'Quality' -> Mạch Nguyễn Phi Vân) — the SAME mechanism
//   already used for any order with no counselor. Not a Pre-sales
//   assignment; she is not on the round-robin roster.
//
// Two staffing patterns exist among Pre-sales staff, so "3 different khung
// giờ" means different things per person:
//   'standard'     — the existing global 3-slot system (callSlots.js):
//                     AM business hours / PM business hours / outside
//                     business hours. Matches Phạm Thị Ngọc Viên's normal
//                     office schedule exactly, no new logic needed.
//   'evening_gap'  — telesales staff (Phan Bùi Giang Thanh, Trần Thị Huyền
//                     Trang) who only call in the evening: 3 distinct call
//                     times in the evening window, each >= 60 minutes
//                     apart from the others (see callSlots.js
//                     hasThreeGappedEveningCalls). Evening window defined
//                     as 17:00-23:00 VN time pending confirmation.
//
// uncontactable_transfers gets a transfer_type + from-presales columns so
// a lead's Presales-hop count (1st vs 2nd) can be read straight from
// existing history — no separate counter to keep in sync.
//
// presales_working_hours backs a new Staff Targets grid (hours/day x
// days/month, editable per staffer per month) — the round-robin now picks
// whoever is furthest behind their fair share (received ÷ monthly
// capacity), not just "fewest received", for BOTH the original Sales-
// >Presales hop and this new Presales-internal chain.
//
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addPresalesEscalation.js
//   PROD: node src/migrations/addPresalesEscalation.js --allow-remote
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

  await pool.query(`ALTER TABLE uncontactable_transfer_presales_staff
      ADD COLUMN IF NOT EXISTS slot_mode text NOT NULL DEFAULT 'standard'`);

  await pool.query(`ALTER TABLE uncontactable_transfers
      ADD COLUMN IF NOT EXISTS transfer_type text NOT NULL DEFAULT 'sales_to_presales'`);
  await pool.query(`ALTER TABLE uncontactable_transfers
      ADD COLUMN IF NOT EXISTS from_presales_staff_id integer REFERENCES staff(id)`);
  await pool.query(`ALTER TABLE uncontactable_transfers
      ADD COLUMN IF NOT EXISTS from_presales_name text`);
  // to_presales_staff_id/to_presales_name already exist and are reused for
  // the final hop too (pointing at Phi Vân), even though she isn't
  // "Pre-sales" — simplest way to keep one audit trail / one round-robin
  // query without a parallel schema for one recipient.

  await pool.query(`CREATE TABLE IF NOT EXISTS presales_working_hours (
      id SERIAL PRIMARY KEY,
      staff_id integer NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      month date NOT NULL,
      hours_per_day numeric NOT NULL DEFAULT 0,
      days_per_month numeric NOT NULL DEFAULT 0,
      updated_by text,
      updated_at timestamptz DEFAULT now(),
      UNIQUE (staff_id, month)
    )`);

  const check = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='uncontactable_transfer_presales_staff' AND column_name='slot_mode') AS slot_mode_col,
      (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='uncontactable_transfers' AND column_name='transfer_type') AS transfer_type_col,
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='presales_working_hours') AS hours_table
  `);
  console.log('Expect slot_mode_col=1, transfer_type_col=1, hours_table=1:', check.rows[0]);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

// One-off data setup for the Pre-sales Uncontactable escalation chain
// (confirmed 2026-08) — run once after addPresalesEscalation.js. Idempotent
// (safe to re-run): each step is a no-op if already applied.
//
//   1. Slot modes: Phạm Thị Ngọc Viên -> 'standard' (already the column
//      default; set explicitly for clarity). Phan Bùi Giang Thanh, Trần
//      Thị Huyền Trang -> 'evening_gap'.
//   2. Lê Thị Tuyết Linh removed from the round-robin roster (resigned) —
//      her staff account itself is left untouched, per instruction.
//   3. presales_working_hours seeded for the CURRENT month from the given
//      weekly figures, converted to a monthly day-count (days/week × 52/12):
//        Trần Thị Huyền Trang — 3h/day × 7 days/week  -> ~30.3 days/month
//        Phan Bùi Giang Thanh — 2h/day × 5 days/week  -> ~21.7 days/month
//        Phạm Thị Ngọc Viên   — 3h/day × 5 days/week  -> ~21.7 days/month
//      cô Như can fine-tune these (and future months) via the new Staff
//      Targets grid — this is just a reasonable starting point so the
//      weighted round-robin has real numbers from day one.
//
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node scripts/configurePresalesEscalation.js
//   PROD: node scripts/configurePresalesEscalation.js --allow-remote
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

const WEEKS_PER_MONTH = 52 / 12;

function vnMonthKey(now = new Date()) {
  const VN_MS = 7 * 60 * 60 * 1000;
  const vn = new Date(now.getTime() + VN_MS);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

(async () => {
  console.log('Target DB host: ' + host);

  async function staffId(name) {
    const r = await pool.query(`SELECT id FROM staff WHERE full_name = $1 LIMIT 1`, [name]);
    return r.rows[0]?.id || null;
  }

  const trangId = await staffId('Trần Thị Huyền Trang');
  const thanhId = await staffId('Phan Bùi Giang Thanh');
  const vienId  = await staffId('Phạm Thị Ngọc Viên');
  const linhId  = await staffId('Lê Thị Tuyết Linh');

  if (trangId) await pool.query(`UPDATE uncontactable_transfer_presales_staff SET slot_mode = 'evening_gap' WHERE staff_id = $1`, [trangId]);
  if (thanhId) await pool.query(`UPDATE uncontactable_transfer_presales_staff SET slot_mode = 'evening_gap' WHERE staff_id = $1`, [thanhId]);
  if (vienId)  await pool.query(`UPDATE uncontactable_transfer_presales_staff SET slot_mode = 'standard' WHERE staff_id = $1`, [vienId]);
  console.log('Slot modes set:', { trangId, thanhId, vienId });

  if (linhId) {
    const del = await pool.query(`DELETE FROM uncontactable_transfer_presales_staff WHERE staff_id = $1`, [linhId]);
    console.log('Removed Lê Thị Tuyết Linh from roster:', del.rowCount, 'row(s) — account untouched');
  } else {
    console.log('Lê Thị Tuyết Linh not found by name — skipped');
  }

  const monthKey = vnMonthKey();
  const hours = [
    { id: trangId, name: 'Trần Thị Huyền Trang', hoursPerDay: 3, daysPerWeek: 7 },
    { id: thanhId, name: 'Phan Bùi Giang Thanh', hoursPerDay: 2, daysPerWeek: 5 },
    { id: vienId,  name: 'Phạm Thị Ngọc Viên',   hoursPerDay: 3, daysPerWeek: 5 },
  ];
  for (const h of hours) {
    if (!h.id) { console.log(`Skipped (not found): ${h.name}`); continue; }
    const daysPerMonth = Math.round(h.daysPerWeek * WEEKS_PER_MONTH * 10) / 10;
    await pool.query(
      `INSERT INTO presales_working_hours (staff_id, month, hours_per_day, days_per_month, updated_by)
       VALUES ($1, $2, $3, $4, 'configurePresalesEscalation.js seed')
       ON CONFLICT (staff_id, month) DO UPDATE SET hours_per_day = EXCLUDED.hours_per_day, days_per_month = EXCLUDED.days_per_month, updated_at = now()`,
      [h.id, monthKey, h.hoursPerDay, daysPerMonth]
    );
    console.log(`Seeded ${h.name} for ${monthKey}: ${h.hoursPerDay}h/day x ${daysPerMonth} days/month`);
  }

  const check = await pool.query(
    `SELECT s.full_name, t.slot_mode FROM uncontactable_transfer_presales_staff t JOIN staff s ON s.id = t.staff_id ORDER BY t.sort_order`
  );
  console.log('Final roster:', check.rows);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

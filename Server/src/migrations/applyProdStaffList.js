// Server/src/migrations/applyProdStaffList.js
// ---------------------------------------------------------------------------
// Applies the confirmed "Staff consolidation mapping - PROD.xlsx" UPDATE rows
// (15 Jul 2026). Run AFTER mergeStaffDuplicates.js has handled the Delete rows:
//   node src/migrations/mergeStaffDuplicates.js --allow-remote \
//        --merge 92=18,87=26,68=2 --retire 95,96 --purge-synthetic
//
// Every update is guarded by id + expected e-mail (old or new, so re-runs are
// idempotent) and the whole batch is one transaction.
//   node src/migrations/applyProdStaffList.js --dry-run --allow-remote   # inspect
//   node src/migrations/applyProdStaffList.js --allow-remote             # apply
// ---------------------------------------------------------------------------
require('dotenv').config();
const { Pool } = require('pg');

const DRY = process.argv.includes('--dry-run');
const ALLOW_REMOTE = process.argv.includes('--allow-remote');
const url = process.env.DATABASE_URL || '';
const host = (url.match(/@([^:@/]+)/) || [])[1] || '(?)';
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
if (!isLocal && !ALLOW_REMOTE) {
  console.error(`ABORT: non-local host "${host}". Use --allow-remote for a deliberate PROD run.`);
  process.exit(1);
}
const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

const FROM = '2026-07-15T00:00:00+07:00';
const UNTIL = '2026-07-18T20:00:00+07:00';
const EVT = { position: 'StudyLink event staff', role: 'Event staff' };

// { id, emails: acceptable current e-mails (old/new), set: fields to write }
const PLAN = [
  // Tâm Nguyên — back as Staff, Pre-sales (confirmed 15 Jul): activate only, NO window.
  { id: 26, emails: ['tamnguyen.studylink@outlook.com'], set: { is_active: true } },
  // Phúc Lâm — already event staff + active: fair window only.
  { id: 3, emails: ['lam.nguyen@studylink.org'], set: { access_valid_from: FROM, access_valid_until: UNTIL } },
  // Thu Lan — per the sheet: becomes kiosk-only event staff for the fair.
  { id: 55, emails: ['thulan.studylink@outlook.com'], set: { ...EVT, access_valid_from: FROM, access_valid_until: UNTIL } },
  // Mỹ Ly — position/role were swapped; restore profile + tier.
  { id: 10, emails: ['myly.studylink@outlook.com'], set: { position: 'Staff, Counsellor', role: 'Staff' } },
  // Part-timers — proper names + e-mails + fair window (position/role already event staff).
  { id: 94, emails: ['tanphatpt202607@studylink.org', 'tanphat@studylink.org'],
    set: { full_name: 'Nguyễn Tấn Phát', email: 'tanphat@studylink.org', access_valid_from: FROM, access_valid_until: UNTIL } },
  { id: 93, emails: ['phuonglinhpt202607@studylink.org', 'phuonglinh@studylink.org'],
    set: { full_name: 'Phương Linh', email: 'phuonglinh@studylink.org', access_valid_from: FROM, access_valid_until: UNTIL } },
  { id: 97, emails: ['tuongvypt202607@studylink.org', 'truongvy@studylink.org'],
    set: { full_name: 'Tường Vy', email: 'truongvy@studylink.org', access_valid_from: FROM, access_valid_until: UNTIL } },
  // Như Ý — stays Staff, Marketing but tier drops Executive → Staff; fair window.
  { id: 98, emails: ['ynguyen.16082002n@gmail.com'], set: { role: 'Staff', access_valid_from: FROM, access_valid_until: UNTIL } },
  // Duy Tú + the Lễ Tân crew — event staff (fixes Executive over-privilege), fair window,
  // names cleaned of the "- Lễ Tân" suffix.
  { id: 99, emails: ['tranngocduytu02@gmail.com'], set: { ...EVT, access_valid_from: FROM, access_valid_until: UNTIL } },
  { id: 100, emails: ['an0567728@gmail.com'], set: { full_name: 'Nguyễn Bảo Ân', ...EVT, access_valid_from: FROM, access_valid_until: UNTIL } },
  { id: 101, emails: ['hyennhi1106@gmail.com'], set: { full_name: 'Huỳnh Ngọc Yến Nhi', ...EVT, access_valid_from: FROM, access_valid_until: UNTIL } },
  { id: 102, emails: ['vnthaohien@gmail.com'], set: { full_name: 'Võ Ngọc Thảo Hiền', ...EVT, access_valid_from: FROM, access_valid_until: UNTIL } },
  { id: 103, emails: ['caogiahy58@gmail.com'], set: { full_name: 'Cao Gia Hy', ...EVT, access_valid_from: FROM, access_valid_until: UNTIL } },
  { id: 104, emails: ['anhdongnguyen291@gmail.com'], set: { full_name: 'Nguyễn Đông Anh', ...EVT, access_valid_from: FROM, access_valid_until: UNTIL } },
  { id: 105, emails: ['giahan100294@gmail.com'], set: { full_name: 'Trương Gia Hân', ...EVT, access_valid_from: FROM, access_valid_until: UNTIL } },
  { id: 106, emails: ['bln12oct@gmail.com'], set: { full_name: 'Bạch Lê Nin', ...EVT, access_valid_from: FROM, access_valid_until: UNTIL } },
];

(async () => {
  const client = await pool.connect();
  let applied = 0, skipped = 0;
  try {
    console.log(`Host: ${host}${DRY ? '  (DRY RUN — no writes)' : ''}`);
    await client.query('BEGIN');
    for (const p of PLAN) {
      const cur = await client.query(
        `SELECT id, full_name, email, position, role, is_active FROM staff WHERE id = $1`, [p.id]);
      if (!cur.rowCount || !p.emails.includes(cur.rows[0].email.toLowerCase())) {
        console.log(`  SKIP #${p.id}: not found or e-mail mismatch (${cur.rowCount ? cur.rows[0].email : 'missing'})`);
        skipped++;
        continue;
      }
      const s = cur.rows[0];
      const changes = Object.entries(p.set)
        .filter(([k, v]) => String(s[k] ?? '') !== String(v))
        .map(([k, v]) => `${k}: "${s[k] ?? ''}" -> "${v}"`);
      console.log(`  #${p.id} ${s.full_name} <${s.email}>`);
      console.log(changes.length ? changes.map(c => `      ${c}`).join('\n') : '      (already up to date)');
      if (!DRY) {
        const cols = Object.keys(p.set);
        const vals = Object.values(p.set);
        await client.query(
          `UPDATE staff SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${cols.length + 1}`,
          [...vals, p.id]);
      }
      applied++;
    }
    await client.query(DRY ? 'ROLLBACK' : 'COMMIT');
    console.log(`${DRY ? 'Would apply' : '✓ Applied'} ${applied} update(s), ${skipped} skipped.`);
    if (skipped) process.exitCode = 1;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('✗ FAILED, rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();

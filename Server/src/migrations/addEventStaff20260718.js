// Server/src/migrations/addEventStaff20260718.js
// ---------------------------------------------------------------------------
// Batch-create the event staff for "Fair First Date 18.7.2026".
// For each name: if a staff row already exists (exact name, or a known
// short-name alias) it is left untouched and reported EXISTING; otherwise a
// row is created with:
//   email     [last name][initials of remaining names]@studylink.org
//             (diacritics stripped, lowercase; suffixed 2,3,… on collision)
//   position  StudyLink event staff     role  Event staff
//   password  event20260718 (sha256, same as Staff.verifyPassword)
//   access    2026-07-15 00:00 -> 2026-07-18 20:00 VN time (stored UTC)
// Idempotent: re-running reports everything as EXISTING.
//   node src/migrations/addEventStaff20260718.js                 # dev
//   node src/migrations/addEventStaff20260718.js --allow-remote  # PROD
// ---------------------------------------------------------------------------
require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');
const { stripDiacritics } = require('../utils/eventRep');

const NAMES = [
  'Nguyễn Phúc Lâm',
  'Nguyễn Thanh Cẩm Tú',
  'Tất Thúy Hằng',
  'Nguyễn Thanh Bình',
  'Nguyễn Lê Quỳnh Như',
  'Lê Nguyễn Hương Giang',
  'Ngô Ngọc Trâm Anh',
  'Lê Trần Bảo Uyên',
  'Nguyễn Hoàng Tường Vy',
  'Nguyễn Tấn Phát',
  'Tôn Thất Thanh Toàn',
  'Trần Ngọc Mai Trâm',
  'Đỗ Anh Thư',
  'Trần Phương Linh',
  'Phạm Thị Diễm Thi',
];

// Existing PROD rows created earlier under shortened names — same people.
const ALIASES = {
  'Trần Phương Linh': 'Phương Linh',        // staff id 93
  'Nguyễn Hoàng Tường Vy': 'Tường Vy',      // staff id 97
};

const POSITION = 'StudyLink event staff';
const ROLE     = 'Event staff';
const PASSWORD = 'event20260718';
const FROM_UTC  = '2026-07-14T17:00:00Z';   // 2026-07-15 00:00 VN (UTC+7)
const UNTIL_UTC = '2026-07-18T13:00:00Z';   // 2026-07-18 20:00 VN

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// [last name] + [first letter of each remaining name], no diacritics, lowercase.
function emailFor(fullName) {
  const words = String(fullName).trim().split(/\s+/);
  const last = stripDiacritics(words[words.length - 1]);
  const initials = words.slice(0, -1).map((w) => stripDiacritics(w)[0] || '').join('');
  return `${(last + initials).toLowerCase()}@studylink.org`;
}

const ARGS = process.argv.slice(2);
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
  const report = [];
  try {
    await client.query('BEGIN');
    const passwordHash = crypto.createHash('sha256').update(PASSWORD).digest('hex');

    for (const name of NAMES) {
      // Duplicate check: exact name, or the known short-name alias.
      const candidates = [norm(name)];
      if (ALIASES[name]) candidates.push(norm(ALIASES[name]));
      const dup = await client.query(
        `SELECT id, full_name, email FROM staff
          WHERE lower(regexp_replace(full_name, '\\s+', ' ', 'g')) = ANY($1)
          ORDER BY id LIMIT 1`,
        [candidates]
      );
      if (dup.rowCount > 0) {
        const d = dup.rows[0];
        const viaAlias = norm(d.full_name) !== norm(name);
        report.push({ name, status: 'EXISTING', id: d.id, email: d.email,
                      note: viaAlias ? `matched short-name row "${d.full_name}"` : '' });
        continue;
      }

      // Collision-proof the generated e-mail.
      let email = emailFor(name);
      for (let n = 2; ; n++) {
        const clash = await client.query(`SELECT 1 FROM staff WHERE lower(email) = $1 LIMIT 1`, [email]);
        if (clash.rowCount === 0) break;
        email = emailFor(name).replace('@', `${n}@`);
      }

      const ins = await client.query(
        `INSERT INTO staff (full_name, email, position, role, password_hash,
                            is_active, staff_type, access_valid_from, access_valid_until)
         VALUES ($1, $2, $3, $4, $5, true, 'permanent', $6, $7)
         RETURNING id`,
        [name, email, POSITION, ROLE, passwordHash, FROM_UTC, UNTIL_UTC]
      );
      report.push({ name, status: 'NEW', id: ins.rows[0].id, email, note: '' });
    }

    await client.query('COMMIT');
    console.log(`✓ COMMITTED on ${host}\n`);
    const w = Math.max(...NAMES.map((n) => n.length)) + 2;
    for (const r of report) {
      console.log(
        `${r.status.padEnd(9)} ${r.name.padEnd(w)} id=${String(r.id).padEnd(5)} ${r.email}${r.note ? '   [' + r.note + ']' : ''}`
      );
    }
    const news = report.filter((r) => r.status === 'NEW').length;
    console.log(`\n${news} created, ${report.length - news} already existed.`);
    console.log(`Password for new accounts: ${PASSWORD}  ·  access ${FROM_UTC} → ${UNTIL_UTC} (UTC)`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('✗ rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();

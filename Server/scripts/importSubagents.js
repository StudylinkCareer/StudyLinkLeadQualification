// Server/scripts/importSubagents.js
// ---------------------------------------------------------------------------
// One-off import of the sub-agent lists (one CSV per staff member who manages
// them) into the B2B party list "Subagents" (lookup_values b2b_party/Subagents)
// — the list behind the B2B referral dropdown and Reference Data page.
// Keeps the old SBS code (owner, 2026-10: "để dễ tìm thông tin"), the manager,
// email, phone and any note in meta.
//
// CSV layout (as exported from Excel): title row, blank row, header row
// "No.,Mã,Tên Sub,Email,<phone>,<note...>", then data rows.
//
// Matching is by name (accent/case/space-insensitive): an existing entry gets
// its details filled in, a name in both files (or twice) becomes one entry with
// both codes/managers. "Ngưng hoạt động" / "Không còn hợp tác" -> hidden.
//
// Dry run by default. Guard: refuses a non-local DB unless --allow-remote.
//   node scripts/importSubagents.js "<csv>" "<manager>" ["<csv>" "<manager>" ...] [--apply] [--allow-remote]
// ---------------------------------------------------------------------------
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const allowRemote = args.includes('--allow-remote');
const pairs = args.filter((a) => !a.startsWith('--'));
if (!pairs.length || pairs.length % 2) {
  console.error('Usage: node scripts/importSubagents.js "<csv>" "<manager>" [...] [--apply] [--allow-remote]');
  process.exit(1);
}

const url = process.env.DATABASE_URL || '';
const host = (url.split('@')[1] || '').split('/')[0] || '(unknown)';
const isLocal = /localhost|127\.0\.0\.1|studylink_dev/.test(url);
if (!isLocal && !allowRemote) { console.error(`Refusing non-local DB (${host}) without --allow-remote`); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const fold = (v) => clean(v).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();
const NO_VALUE = /^(không có (số đt|email)\.?|no phone)$/i;
const INACTIVE = /ngưng hoạt động|không còn hợp tác/i;

function cleanEmail(v) {
  const parts = String(v || '').split(/[;,\n]/).map(clean).filter((x) => x && !NO_VALUE.test(x));
  return [...new Set(parts)].join('; ');
}
function cleanPhone(v) {
  const s = clean(v);
  if (!s || NO_VALUE.test(s)) return { phone: '', note: '' };
  if (!/\d{3}/.test(s)) return { phone: '', note: s };                     // text in the phone column
  // Excel dropped the leading 0 of plain 9-digit VN mobiles (903305160 -> 0903305160).
  return { phone: /^[35789]\d{8}$/.test(s) ? '0' + s : s, note: '' };
}

function readList(file, manager) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = parse(raw, { relax_column_count: true, relax_quotes: true, skip_empty_lines: false });
  const h = rows.findIndex((r) => clean(r[0]).toLowerCase().startsWith('no') && /mã/i.test(clean(r[1])));
  if (h < 0) throw new Error(`${file}: header row "No., Mã, Tên Sub, ..." not found`);
  const out = [];
  for (const r of rows.slice(h + 1)) {
    const name = clean(r[2]);
    if (!name) continue;
    const { phone, note: phoneNote } = cleanPhone(r[4]);
    const extra = r.slice(5).map(clean).filter(Boolean);
    const note = [phoneNote, ...extra].filter(Boolean).join(' · ');
    out.push({
      no: clean(r[0]), code: clean(r[1]).replace('_', '-').toUpperCase(), name,
      email: cleanEmail(r[3]), phone, note, manager, inactive: INACTIVE.test(`${phoneNote} ${note}`),
    });
  }
  return out;
}

const joinUniq = (a, b) => [...new Set([a, b].flatMap((x) => String(x || '').split('; ')).filter(Boolean))].join('; ');

(async () => {
  console.log(`importSubagents -> ${host} ${apply ? '(APPLY)' : '(dry run)'}`);
  const merged = new Map();
  for (let i = 0; i < pairs.length; i += 2) {
    const list = readList(pairs[i], pairs[i + 1]);
    console.log(`  ${pairs[i + 1]}: ${list.length} rows`);
    for (const x of list) {
      const k = fold(x.name);
      const cur = merged.get(k);
      if (!cur) { merged.set(k, { ...x }); continue; }
      cur.code = joinUniq(cur.code, x.code); cur.manager = joinUniq(cur.manager, x.manager);
      cur.email = joinUniq(cur.email, x.email); cur.phone = joinUniq(cur.phone, x.phone);
      cur.note = joinUniq(cur.note, x.note); cur.inactive = cur.inactive && x.inactive;
      cur.mergedFrom = (cur.mergedFrom || 1) + 1;
    }
  }
  const items = [...merged.values()];

  // Same SBS code on different subs: flag only, both kept.
  const byCode = new Map();
  for (const it of items) for (const c of it.code.split('; ').filter(Boolean)) byCode.set(c, [...(byCode.get(c) || []), it.name]);
  const sharedCodes = [...byCode].filter(([, n]) => n.length > 1);

  const existing = (await pool.query(
    `SELECT id, code, is_active, meta FROM lookup_values WHERE category='b2b_party' AND subcategory='Subagents'`)).rows;
  const exByKey = new Map(existing.map((e) => [fold(e.code), e]));
  const toUpdate = items.filter((it) => exByKey.has(fold(it.name)));
  const toInsert = items.filter((it) => !exByKey.has(fold(it.name)));

  console.log(`  unique subs: ${items.length} | merged duplicates: ${items.filter((i) => i.mergedFrom).map((i) => `${i.name} (${i.code})`).join(' | ') || 'none'}`);
  console.log(`  already in the app (details filled in): ${toUpdate.length} -> ${toUpdate.map((i) => i.name).join(' | ')}`);
  console.log(`  new: ${toInsert.length} | hidden (stopped/ended): ${items.filter((i) => i.inactive).map((i) => i.name).join(' | ') || 'none'}`);
  console.log(`  same SBS code on different subs (kept, flagged): ${sharedCodes.map(([c, n]) => `${c}: ${n.join(' / ')}`).join(' || ') || 'none'}`);
  console.log(`  no SBS code: ${items.filter((i) => !i.code).length} | no email: ${items.filter((i) => !i.email).length} | no phone: ${items.filter((i) => !i.phone).length}`);
  console.log('  sample:', JSON.stringify(items.slice(0, 3), null, 1));

  if (!apply) { console.log('Dry run only. Re-run with --apply to write.'); await pool.end(); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const metaOf = (it, base = {}) => {
      const m = { ...base };
      for (const [k, v] of [['sbs_code', it.code], ['manager', it.manager], ['email', it.email], ['phone', it.phone], ['note', it.note]]) {
        if (v) m[k] = v; else delete m[k];
      }
      return m;
    };
    for (const it of toUpdate) {
      const e = exByKey.get(fold(it.name));
      await client.query(`UPDATE lookup_values SET meta=$2::jsonb, is_active=$3 WHERE id=$1`,
        [e.id, JSON.stringify(metaOf(it, e.meta || {})), !it.inactive]);
    }
    let n = (await client.query(`SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM lookup_values WHERE category='b2b_party' AND subcategory='Subagents'`)).rows[0].n;
    for (const it of toInsert) {
      await client.query(
        `INSERT INTO lookup_values (category, subcategory, code, sort_order, is_active, meta)
         VALUES ('b2b_party','Subagents',$1,$2,$3,$4::jsonb)`,
        [it.name, n++, !it.inactive, JSON.stringify(metaOf(it))]);
    }
    await client.query('COMMIT');
    const c = (await pool.query(`SELECT count(*) FILTER (WHERE is_active) act, count(*) tot FROM lookup_values WHERE category='b2b_party' AND subcategory='Subagents'`)).rows[0];
    console.log(`Applied: updated ${toUpdate.length}, inserted ${toInsert.length}. Subagents now: ${c.act} active / ${c.tot} total.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('FAILED, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });

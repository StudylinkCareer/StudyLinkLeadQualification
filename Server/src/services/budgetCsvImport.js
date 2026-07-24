// Server/src/services/budgetCsvImport.js
// ─────────────────────────────────────────────────────────────────────
// Parses the team's real event-budget spreadsheet export (see e.g.
// "QT.Budget"/"KHTL.Budget") into event_budget_items rows.
//
// Real-file shape, reverse-engineered from actual exports:
//   - A few metadata rows (Sự kiện/Thời gian/Địa điểm/Mục tiêu), then blank.
//   - A header row: Hạng mục, Nội dung, Chi tiết, Đơn vị tính, Đơn giá,
//     Số lượng, Thành tiền [, Đơn giá, Số lượng, Thành tiền] , Note, Ghi chú.
//     The second Đơn giá/Số lượng/Thành tiền triplet (THỰC TẾ = actual) only
//     exists once the event has actually happened — a pre-event "Kế hoạch"
//     export only has the first (KẾ HOẠCH = planned) triplet.
//   - SECTION rows: Hạng mục = "Ngân sách quảng cáo" / "...đối tác truyền
//     thông" / "...in ấn" / "...vận hành..." / "...quà tặng", every other
//     column blank except Thành tiền (a rollup total for that section, not
//     an importable line item).
//   - DATA rows: Hạng mục holds a vendor/campaign mini-label (e.g. "Zalo",
//     "Freelancer") which repeats via BLANK cells on continuation rows
//     (merged cells in the source spreadsheet) until the next non-blank
//     Hạng mục. Nội dung/Chi tiết/Đơn vị/giá/SL/Thành tiền are the real data.
//   - A TỔNG CỘNG/TỔNG TIỀN TÀI TRỢ block at the bottom — only
//     "Tổng tiền tài trợ" is imported (-> total_sponsorship); everything
//     else there is derived on our side from the line items themselves.
//
// Vietnamese CSV exports out of this pipeline have shown up encoded so that
// UTF-8 bytes get reinterpreted as Windows-1252 ("Sự kiện" -> "Sá»± kiá»n").
// fixMojibake() reverses that specific, well-known corruption when detected.
// ─────────────────────────────────────────────────────────────────────
const { parse } = require('csv-parse/sync');

const SECTION_ALIASES = [
  { match: /qu[aả]ng\s*c[aá]o/i, category: 'Quảng cáo' },
  { match: /(đ[oố]i\s*t[aá]c|truy[eề]n\s*th[oô]ng)/i, category: 'Đối tác truyền thông' },
  { match: /in\s*[aấ]n/i, category: 'In ấn' },
  { match: /v[aậ]n\s*h[aà]nh/i, category: 'Vận hành sự kiện' },
  { match: /qu[aà]\s*t[aặ]ng/i, category: 'Quà tặng' },
];

// Reverse "UTF-8 bytes misread as Windows-1252/Latin-1" mojibake. Only
// applies the fix if it plausibly helps (fewer garbled markers afterwards) —
// never touches text that's already clean UTF-8.
const MOJIBAKE_MARKERS = /[ÃÂ]|á»|â€/;
function fixMojibake(str) {
  if (!str || typeof str !== 'string') return str;
  if (!MOJIBAKE_MARKERS.test(str)) return str;
  try {
    const fixed = Buffer.from(str, 'latin1').toString('utf8');
    const before = (str.match(MOJIBAKE_MARKERS) || []).length;
    const after = (fixed.match(MOJIBAKE_MARKERS) || []).length;
    if (after < before && !fixed.includes('�')) return fixed;
  } catch {
    // fall through, keep original
  }
  return str;
}

function parseVndNumber(cell) {
  if (cell == null) return null;
  const s = String(cell).trim();
  if (s === '') return null;
  const n = Number(s.replace(/[,\s]/g, ''));
  return isNaN(n) ? null : n;
}

function normalizeSection(rawHangMuc) {
  const s = (rawHangMuc || '').trim();
  if (!/ng[aâ]n\s*s[aá]ch/i.test(s)) return null; // not a section row at all
  for (const { match, category } of SECTION_ALIASES) {
    if (match.test(s)) return category;
  }
  return s.replace(/ng[aâ]n\s*s[aá]ch\s*/i, '').trim() || s;
}

// parseBudgetCsv(csvText) -> { plannedItems, actualItems, totalSponsorship, hasActualColumns }
function parseBudgetCsv(csvText) {
  const rawRows = parse(csvText, { relax_column_count: true, skip_empty_lines: false });
  const rows = rawRows.map((r) => r.map((c) => fixMojibake(typeof c === 'string' ? c : c)));

  // Find the real header row: first cell case-insensitively starts with "Hạng mục".
  let headerIdx = rows.findIndex((r) => /^h[aạ]ng\s*m[uụ]c/i.test((r[0] || '').trim()));
  if (headerIdx === -1) {
    throw new Error('Could not find the "Hạng mục" header row — is this the right file?');
  }
  const header = rows[headerIdx];
  // Dual layout: a second "Thành tiền" column exists (Đơn giá, Số lượng, Thành tiền x2).
  const thanhTienIdxs = header
    .map((h, i) => (/^th[aà]nh\s*ti[eề]n/i.test((h || '').trim()) ? i : -1))
    .filter((i) => i !== -1);
  const hasActualColumns = thanhTienIdxs.length >= 2;
  const [donGiaKh, slKh, ttKh] = [thanhTienIdxs[0] - 2, thanhTienIdxs[0] - 1, thanhTienIdxs[0]];
  const [donGiaTt, slTt, ttTt] = hasActualColumns
    ? [thanhTienIdxs[1] - 2, thanhTienIdxs[1] - 1, thanhTienIdxs[1]]
    : [null, null, null];
  const unitIdx = donGiaKh - 1;
  const noteStartIdx = (hasActualColumns ? ttTt : ttKh) + 1;

  const plannedItems = [];
  const actualItems = [];
  let currentSection = 'Khác'; // the true category (Ngân sách quảng cáo -> "Quảng cáo", etc.)
  let currentLabel = '';       // the vendor/campaign mini-label used to build the line-item name
  let totalSponsorship = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const hangMuc = (row[0] || '').trim();
    const noiDung = (row[1] || '').trim();
    const chiTiet = (row[2] || '').trim();
    const unit = (row[unitIdx] || '').trim();

    if (/t[oổ]ng\s*ti[eề]n\s*t[aà]i\s*tr[oợ]/i.test(hangMuc)) {
      totalSponsorship = parseVndNumber(hasActualColumns ? row[ttTt] : row[ttKh]);
      continue;
    }
    if (/t[oổ]ng\s*c[oộ]ng\s*chi\s*ph[ií]|t[oổ]ng\s*ng[aâ]n\s*s[aá]ch/i.test(hangMuc)) {
      continue; // derived totals — we compute these ourselves from line items
    }
    if (/t[oổ]ng\s*ti[eề]n\s*c[oò]n/i.test(hangMuc)) {
      // "Tổng tiền còn lại" is always the last of the summary rows in these
      // exports — everything after it (lead/CPL projections, etc.) is not
      // budget-item data, so stop parsing here rather than importing it.
      break;
    }

    const section = normalizeSection(hangMuc);
    if (section != null && !noiDung && !chiTiet && !unit) {
      // Section rollup row (e.g. "Ngân sách quảng cáo") — sets the category
      // for subsequent rows, not itself an importable line item.
      currentSection = section;
      currentLabel = '';
      continue;
    }

    if (hangMuc) currentLabel = hangMuc;
    if (!currentLabel && !noiDung) continue; // fully blank row, skip

    const lineItem = [currentLabel, noiDung].filter(Boolean).join(' — ') || noiDung || currentLabel;
    if (!lineItem) continue;

    const note = [row[noteStartIdx], row[noteStartIdx + 1]].filter((x) => x && x.trim()).join(' / ') || null;

    if (row[ttKh] != null && String(row[ttKh]).trim() !== '') {
      plannedItems.push({
        category: currentSection, lineItem, unit: unit || null,
        unitPrice: parseVndNumber(row[donGiaKh]), quantity: parseVndNumber(row[slKh]),
        amount: parseVndNumber(row[ttKh]) ?? 0, note,
      });
    }
    if (hasActualColumns && row[ttTt] != null && String(row[ttTt]).trim() !== '') {
      actualItems.push({
        category: currentSection, lineItem, unit: unit || null,
        unitPrice: parseVndNumber(row[donGiaTt]), quantity: parseVndNumber(row[slTt]),
        amount: parseVndNumber(row[ttTt]) ?? 0, note,
      });
    }
  }

  return { plannedItems, actualItems, totalSponsorship, hasActualColumns };
}

module.exports = { parseBudgetCsv, fixMojibake, parseVndNumber };

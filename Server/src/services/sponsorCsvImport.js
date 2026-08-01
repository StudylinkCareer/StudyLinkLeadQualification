// Server/src/services/sponsorCsvImport.js
// ─────────────────────────────────────────────────────────────────────
// Parses the team's real "school sponsor list" spreadsheet tab (separate
// from the budget Kế hoạch/Quyết toán tab — that one only carries the single
// aggregate "Tổng tiền tài trợ" figure; THIS tab is the per-institution
// breakdown behind it).
//
// Real-file shape:
//   Quốc gia, Trường, Ngân sách, Đơn vị, Tỷ Giá (...), Thành VND, Note,
//   Standee để bàn [, <unrelated currency-rate reference cells>]
//   - Quốc gia (country) is only filled on the first row of each country
//     group (merged cell in the source spreadsheet) — carries forward.
//   - Ngân sách is either a number or the literal "FREE".
//   - Trailing columns after "Standee để bàn" are a stray currency-rate
//     lookup table jammed into the same sheet — ignored entirely.
//   - A "TỔNG" (total) row at the end is skipped; we compute our own total
//     from the parsed rows.
// ─────────────────────────────────────────────────────────────────────
const { parse } = require('csv-parse/sync');
const { fixMojibake, parseVndNumber } = require('./budgetCsvImport');

// parseSponsorCsv(csvText) -> [{ country, school, amountOriginal, currency,
//   exchangeRate, amountVnd, isFree, standeeProvided, note }]
function parseSponsorCsv(csvText) {
  const rawRows = parse(csvText, { relax_column_count: true, skip_empty_lines: false });
  const rows = rawRows.map((r) => r.map((c) => fixMojibake(typeof c === 'string' ? c : c)));

  const headerIdx = rows.findIndex((r) => /qu[oố]c\s*gia/i.test((r[0] || '').trim()));
  if (headerIdx === -1) {
    throw new Error('Could not find the "Quốc gia" header row — is this the right file?');
  }

  const items = [];
  let currentCountry = '';

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const countryCell = (row[0] || '').trim();
    const school = (row[1] || '').trim();
    const budgetRaw = (row[2] || '').trim();
    const currency = (row[3] || '').trim();
    const rate = (row[4] || '').trim();
    const vndRaw = (row[5] || '').trim();
    const note = (row[6] || '').trim();
    const standeeRaw = (row[7] || '').trim();

    if (countryCell) currentCountry = countryCell;
    if (!school) continue; // blank row or trailing reference-table-only row
    if (/^t[oổ]ng$/i.test(school)) continue; // the TỔNG total row — computed ourselves

    const isFree = /^free$/i.test(budgetRaw);
    items.push({
      country: currentCountry || null,
      school,
      amountOriginal: isFree ? null : parseVndNumber(budgetRaw),
      currency: isFree ? null : (currency || null),
      exchangeRate: isFree ? null : parseVndNumber(rate),
      amountVnd: isFree ? 0 : (parseVndNumber(vndRaw) ?? 0),
      isFree,
      standeeProvided: standeeRaw === '1' || /^(y|yes|true)$/i.test(standeeRaw),
      note: note || null,
    });
  }

  return items;
}

module.exports = { parseSponsorCsv };

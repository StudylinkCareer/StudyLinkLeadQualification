// server/src/scripts/importNotesFromExcel.js
//
// One-shot importer for the StudyLink notes upload template (Excel).
//
// USAGE:
//   node importNotesFromExcel.js                       (DRY RUN — no DB writes)
//   node importNotesFromExcel.js --commit              (Actually writes to DB)
//
// PRE-REQUISITES:
//   1. Place the Excel file at:  ../../Notes_Upload_Template_-_update_2.xlsx
//      (i.e. two levels above this script — alongside production_data.csv)
//   2. Install xlsx package:     npm install xlsx
//
// WHAT IT DOES:
//   Reads the 3 sheets in the upload template:
//     - "student_download_…"  → leads (unique_id + full_name)
//     - "Students"            → notes  (unique_id, content, author, type, date)
//     - "Approved list"       → not used (reference only)
//
//   For LEADS:
//     - The unique_id in the file is the source of truth.
//     - Skip if unique_id already exists in DB (don't overwrite).
//     - Otherwise create the lead with that unique_id.
//     - created_at is derived from the first 8 chars (YYYYMMDD) of unique_id.
//     - A *report only* lists new leads whose name matches an existing lead in
//       DB (different unique_id) — no action taken on these. Review afterwards
//       if you want to merge.
//
//   For NOTES:
//     - Skip if content is empty.
//     - Skip if author_id doesn't match an existing staff.id.
//     - Skip if note_type isn't Counselor or PreSales.
//     - Map note_type:  Counselor → counselor,  PreSales → presales.
//     - DATE FIX: if created_at is after today, swap day↔month. Most "future"
//       dates are dd/MM juxtaposition. If the swap produces a valid past date,
//       use it. If not (e.g. day was already > 12), import original and log.
//     - Idempotent: skip if same (student_id, author_id, content, created_at)
//       note already exists.
//
// REPORTING:
//   Prints a console summary. Detail JSON files written next to the script:
//     ./import-report-name-matches.json     (informational only)
//     ./import-report-bad-authors.json
//     ./import-report-date-swaps.json       (every date that was swapped)
//     ./import-report-date-unfixable.json   (future dates whose swap failed)

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const pool = require('./db');

// ── Config ────────────────────────────────────────────────────
const EXCEL_PATH = path.join(__dirname, '../../Notes_Upload_Template - update 2.xlsx');
const COMMIT     = process.argv.includes('--commit');

const NOTE_TYPE_MAP = {
  'Counselor':  'counselor',
  'PreSales':   'presales',
  'Management': 'management',
};

// ── Helpers ───────────────────────────────────────────────────
function normalizeName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function deriveCreatedAt(studentId) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(studentId || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// Parse any cell value into a Date (UTC). Returns null if unparseable.
function toDate(v) {
  if (v == null) return null;
  if (v instanceof Date && !isNaN(v)) return v;
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

// If `d` is after today, try to swap day↔month and return the swapped date if
// valid. Returns { date, swapped, swapError }.
function maybeSwapFutureDate(d, today) {
  if (!d || d <= today) return { date: d, swapped: false };

  const y  = d.getUTCFullYear();
  const m  = d.getUTCMonth() + 1;   // 1-12
  const dd = d.getUTCDate();        // 1-31

  // Swap requires the original day to be a valid month number (1-12).
  if (dd < 1 || dd > 12) {
    return { date: d, swapped: false, swapError: `day ${dd} > 12, cannot swap` };
  }

  // Build swapped date — new month is the old day, new day is the old month.
  const swapped = new Date(Date.UTC(y, dd - 1, m));
  // Validate — JS will silently roll over invalid dates.
  if (
    swapped.getUTCFullYear() !== y ||
    swapped.getUTCMonth()    !== dd - 1 ||
    swapped.getUTCDate()     !== m
  ) {
    return { date: d, swapped: false, swapError: `swap produced invalid date` };
  }
  // If the swap still leaves us in the future (e.g. d=1, m=1 → same date), bail.
  if (swapped > today) {
    return { date: d, swapped: false, swapError: `swap still in future (${swapped.toISOString().slice(0,10)})` };
  }

  return { date: swapped, swapped: true };
}

function writeJsonReport(name, data) {
  const file = path.join(__dirname, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`   📄  Wrote ${file}`);
}

function findSheet(wb, predicate) {
  const name = wb.SheetNames.find(predicate);
  return name ? wb.Sheets[name] : null;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n📚 Note/Lead importer — mode: ${COMMIT ? '🔴 COMMIT (writing to DB)' : '🟢 DRY RUN (no writes)'}`);
  console.log(`   File: ${EXCEL_PATH}\n`);

  if (!fs.existsSync(EXCEL_PATH)) {
    console.error(`❌ File not found: ${EXCEL_PATH}`);
    process.exit(1);
  }

  // ── Read workbook ────────────────────────────────────────────
  const wb = XLSX.readFile(EXCEL_PATH, { cellDates: true });

  const notesSheet = findSheet(wb, n => n.toLowerCase().includes('student') && !n.toLowerCase().includes('download'))
                  || wb.Sheets['Students'];
  const leadsSheet = findSheet(wb, n => n.toLowerCase().includes('download'));

  if (!notesSheet) { console.error('❌ Could not find "Students" sheet'); process.exit(1); }
  if (!leadsSheet) { console.error('❌ Could not find lead-download sheet'); process.exit(1); }

  const notesRows = XLSX.utils.sheet_to_json(notesSheet, { defval: null });
  const leadsRows = XLSX.utils.sheet_to_json(leadsSheet, { defval: null });

  console.log(`📋 Loaded ${leadsRows.length} leads, ${notesRows.length} notes from Excel\n`);

  // ── Load existing DB state ───────────────────────────────────
  const { rows: existingLeads } = await pool.query(
    'SELECT student_id, full_name FROM students'
  );
  const existingIds = new Set(existingLeads.map(r => r.student_id));

  const namesByNorm = new Map();
  for (const r of existingLeads) {
    const k = normalizeName(r.full_name);
    if (!k) continue;
    if (!namesByNorm.has(k)) namesByNorm.set(k, []);
    namesByNorm.get(k).push(r.student_id);
  }

  const { rows: staffRows } = await pool.query('SELECT id, full_name FROM staff');
  const validStaffIds = new Set(staffRows.map(s => s.id));

  console.log(`🗄  DB state: ${existingIds.size} leads, ${validStaffIds.size} staff members\n`);

  // ── Phase 1: classify leads ──────────────────────────────────
  const leadsToCreate    = [];
  const leadsAlreadyIn   = [];
  const leadsNameMatches = []; // informational only — do not gate creation

  for (const r of leadsRows) {
    if (!r.unique_id) continue;
    const uid = String(r.unique_id).trim();

    if (existingIds.has(uid)) {
      leadsAlreadyIn.push(uid);
      continue;
    }

    const name = String(r.full_name || '').trim();
    const nameKey = normalizeName(name);
    if (nameKey && namesByNorm.has(nameKey)) {
      leadsNameMatches.push({
        new_unique_id:       uid,
        new_full_name:       name,
        existing_unique_ids: namesByNorm.get(nameKey),
        action:              'WILL CREATE (review later if these turn out to be duplicates)',
      });
    }

    leadsToCreate.push({ unique_id: uid, full_name: name });
  }

  // ── Phase 2: classify notes ──────────────────────────────────
  const willHaveIds = new Set([
    ...existingIds,
    ...leadsToCreate.map(r => r.unique_id),
  ]);

  // "today" at end-of-day UTC, so notes dated today aren't treated as future
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);

  const notesValid     = [];
  const notesEmpty     = [];
  const notesOrphan    = [];
  const notesBadAuthor = [];
  const notesBadType   = [];
  const dateSwaps      = [];
  const dateUnfixable  = [];

  for (const n of notesRows) {
    const content = String(n.content || '').trim();
    if (!content) { notesEmpty.push(n); continue; }

    const uid = String(n.unique_id || '').trim();
    if (!willHaveIds.has(uid)) { notesOrphan.push({ unique_id: uid, full_name: n.full_name }); continue; }

    const authorId = Number(n.author_id);
    if (!validStaffIds.has(authorId)) {
      notesBadAuthor.push({ author_id: n.author_id, author_name: n.author_name });
      continue;
    }

    const mappedType = NOTE_TYPE_MAP[String(n.note_type || '').trim()];
    if (!mappedType) { notesBadType.push(n); continue; }

    const original = toDate(n.created_at);
    if (!original) { notesBadType.push({ ...n, _err: 'invalid date' }); continue; }

    const { date: fixed, swapped, swapError } = maybeSwapFutureDate(original, today);

    if (swapped) {
      dateSwaps.push({
        unique_id: uid,
        before:    original.toISOString().slice(0, 10),
        after:     fixed.toISOString().slice(0, 10),
      });
    } else if (original > today) {
      dateUnfixable.push({
        unique_id: uid,
        date:      original.toISOString().slice(0, 10),
        reason:    swapError || 'unknown',
      });
    }

    notesValid.push({
      student_id:  uid,
      note_type:   mappedType,
      content,
      author_id:   authorId,
      author_name: String(n.author_name || '').trim(),
      created_at:  fixed.toISOString(),
    });
  }

  // ── Print report ─────────────────────────────────────────────
  console.log('=== LEAD SUMMARY ===');
  console.log(`  Already in DB (skip):              ${leadsAlreadyIn.length}`);
  console.log(`  Name match w/ existing (FYI only): ${leadsNameMatches.length}`);
  console.log(`  → New leads to be created:         ${leadsToCreate.length}`);
  console.log('');
  console.log('=== NOTE SUMMARY ===');
  console.log(`  Empty content (skip):              ${notesEmpty.length}`);
  console.log(`  Orphan — lead not found (skip):    ${notesOrphan.length}`);
  console.log(`  Unknown author_id (skip):          ${notesBadAuthor.length}`);
  console.log(`  Bad note_type or date (skip):      ${notesBadType.length}`);
  console.log(`  → Notes valid for import:          ${notesValid.length}`);
  console.log('');
  console.log('=== DATE FIXES ===');
  console.log(`  Future dates swapped to past:      ${dateSwaps.length}`);
  console.log(`  Future dates unfixable (kept):     ${dateUnfixable.length}`);
  console.log('');

  // Detail dumps in dry-run mode
  if (!COMMIT) {
    if (leadsNameMatches.length) {
      console.log('--- Sample name matches (first 5) ---');
      for (const m of leadsNameMatches.slice(0, 5)) {
        console.log(`   "${m.new_full_name}"  new=${m.new_unique_id}  existing=${m.existing_unique_ids.join(',')}`);
      }
      writeJsonReport('import-report-name-matches.json', leadsNameMatches);
    }
    if (notesBadAuthor.length) {
      const uniq = [...new Map(notesBadAuthor.map(b => [b.author_id, b])).values()];
      console.log('\n--- Unknown author_ids in upload ---');
      for (const a of uniq) console.log(`   author_id=${a.author_id}  ("${a.author_name}")`);
      writeJsonReport('import-report-bad-authors.json', uniq);
    }
    if (dateSwaps.length) {
      console.log(`\n--- Sample date swaps (first 5) ---`);
      for (const s of dateSwaps.slice(0, 5)) {
        console.log(`   ${s.unique_id}: ${s.before}  →  ${s.after}`);
      }
      writeJsonReport('import-report-date-swaps.json', dateSwaps);
    }
    if (dateUnfixable.length) {
      console.log(`\n⚠  ${dateUnfixable.length} future date(s) couldn't be swapped — see report`);
      writeJsonReport('import-report-date-unfixable.json', dateUnfixable);
    }

    console.log('\n💡  Dry run complete. Review reports, then re-run with --commit.\n');
    return pool.end();
  }

  // ── COMMIT: actually insert ─────────────────────────────────
  console.log('⏳ Inserting leads…');
  let leadOk = 0, leadFail = 0;
  for (const r of leadsToCreate) {
    try {
      const created = deriveCreatedAt(r.unique_id) || new Date();
      await pool.query(
        `INSERT INTO students (student_id, full_name, status, created_at, updated_at)
         VALUES ($1, $2, 'Active', $3, $3)`,
        [r.unique_id, r.full_name, created]
      );
      leadOk++;
    } catch (e) {
      console.error(`   ❌ lead ${r.unique_id}: ${e.message}`);
      leadFail++;
    }
  }
  console.log(`   ✅ ${leadOk} leads inserted, ${leadFail} failed\n`);

  console.log('⏳ Inserting notes…');
  let noteOk = 0, noteSkipDup = 0, noteFail = 0;
  for (const n of notesValid) {
    try {
      const dup = await pool.query(
        `SELECT id FROM student_notes
         WHERE student_id = $1 AND author_id = $2 AND content = $3 AND created_at = $4
         LIMIT 1`,
        [n.student_id, n.author_id, n.content, n.created_at]
      );
      if (dup.rows.length) { noteSkipDup++; continue; }

      await pool.query(
        `INSERT INTO student_notes (student_id, note_type, content, author_id, author_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [n.student_id, n.note_type, n.content, n.author_id, n.author_name, n.created_at]
      );
      noteOk++;
    } catch (e) {
      console.error(`   ❌ note for ${n.student_id}: ${e.message}`);
      noteFail++;
    }
  }
  console.log(`   ✅ ${noteOk} notes inserted, ${noteSkipDup} duplicate notes skipped, ${noteFail} failed\n`);

  console.log('🎉 Import complete.');
  await pool.end();
}

main().catch(err => {
  console.error('FATAL:', err);
  pool.end().finally(() => process.exit(1));
});

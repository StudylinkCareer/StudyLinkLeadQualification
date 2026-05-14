// scripts/normalizeLeads.js
// ─────────────────────────────────────────────────────────────────────
// Walks every row of the `students` table and rewrites any non-canonical
// value to its canonical code, using the alias data in `lookup_values`.
//
// Examples of what gets fixed:
//   destination_country = 'Aus'           →  'Australia'
//   destination_country = 'UK, Aus'       →  'United Kingdom, Australia'
//   residency            = 'Hồ Chí Minh'  →  'Ho Chi Minh City'
//   lead_source          = 'fb ads'        →  'FB-Zalo-GG-TikTok ads' (if aliased)
//
// Values that can't be resolved to ANY canonical code are reported as
// "orphans" and left untouched — staff can decide manually (or add an
// alias in lookup_values.meta.aliases to capture them next run).
//
// REPORTS written to ./normalize-report/ as CSVs (openable in Excel):
//   normalize-changes.csv  — every change that WOULD be made (dry-run)
//                            or WAS made (--apply)
//   normalize-orphans.csv  — every value that couldn't be mapped
//   normalize-summary.csv  — per-field counts of changes / orphans
//
// Each successful change is logged to audit_log with
//   change_source = 'data_cleanup'
//   changed_by    = 'cleanup_script'
//
// Usage:
//   node scripts/normalizeLeads.js                # dry-run (default), CSVs written
//   node scripts/normalizeLeads.js --apply        # actually update rows
//   node scripts/normalizeLeads.js --apply --field destination_country
//                                                  # apply to one column only
//
// Safe to re-run. Already-canonical rows are skipped.
// ─────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const FIELD_ARG_IDX = process.argv.indexOf('--field');
const ONLY_FIELD = FIELD_ARG_IDX >= 0 ? process.argv[FIELD_ARG_IDX + 1] : null;

const REPORT_DIR = path.resolve(__dirname, '../normalize-report');

// ── Field map: DB column → lookup category + multi-value flag ──────
const FIELD_MAP = {
  destination_country:    { category: 'country',             multiValue: true  },
  residency:              { category: 'vietnam_province',    multiValue: false },
  lead_status:            { category: 'lead_status',         multiValue: false },
  stone_tier:             { category: 'stone_tier',          multiValue: false },
  lead_source:            { category: 'lead_source',         multiValue: false },
  study_plans:            { category: 'study_plan',          multiValue: false },
  timeline:               { category: 'timeline',            multiValue: false },
  interaction:            { category: 'interaction',         multiValue: false },
  english_level:          { category: 'english_level',       multiValue: false },
  gpa:                    { category: 'gpa',                 multiValue: false },
  budget:                 { category: 'budget',              multiValue: false },
  confidence:             { category: 'confidence',          multiValue: false },
  scholarship_demand:     { category: 'scholarship_demand',  multiValue: false },
  immigration_history:    { category: 'immigration_history', multiValue: false },
  sponsor_income:         { category: 'sponsor_income',      multiValue: false },
  income_evidence:        { category: 'income_evidence',     multiValue: false },
  study_plan_gap:         { category: 'study_plan_gap',      multiValue: false },
  ultimate_objective:     { category: 'ultimate_objective',  multiValue: false },
  mother_contact_medium:  { category: 'contact_medium',      multiValue: false },
  father_contact_medium:  { category: 'contact_medium',      multiValue: false },
};

const SPLIT_REGEX = /[,;\/&|]| and | or | và | hoặc /i;

// ── CSV helpers ────────────────────────────────────────────────────
// Excel-friendly: UTF-8 BOM at the top so Vietnamese diacritics render,
// values quoted, embedded quotes doubled.
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (/["\n,]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function writeCsv(filepath, header, rows) {
  const BOM = '\uFEFF';
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) lines.push(header.map(h => csvCell(r[h])).join(','));
  fs.writeFileSync(filepath, BOM + lines.join('\r\n'), 'utf8');
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL not set in .env');
    process.exit(1);
  }
  if (ONLY_FIELD && !FIELD_MAP[ONLY_FIELD]) {
    console.error(`ERROR: --field "${ONLY_FIELD}" is not in the FIELD_MAP.`);
    console.error(`Valid fields:\n  ${Object.keys(FIELD_MAP).join('\n  ')}`);
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  console.log(`Mode: ${APPLY ? 'APPLY (will write to DB)' : 'DRY-RUN (no changes will be made)'}`);
  if (ONLY_FIELD) console.log(`Restricting to field: ${ONLY_FIELD}`);
  console.log(`Connecting to ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}\n`);

  // ── Build alias maps per category ────────────────────────────────
  const aliasMaps = {};
  const categoriesNeeded = new Set(
    Object.entries(FIELD_MAP)
      .filter(([f]) => !ONLY_FIELD || f === ONLY_FIELD)
      .map(([, m]) => m.category)
  );

  for (const category of categoriesNeeded) {
    const res = await pool.query(
      `SELECT code, label_en, label_vi, meta
       FROM lookup_values
       WHERE category = $1 AND is_active = TRUE`,
      [category]
    );
    const m = new Map();
    for (const row of res.rows) {
      if (row.code)     m.set(row.code.toLowerCase().trim(), row.code);
      if (row.label_en) m.set(row.label_en.toLowerCase().trim(), row.code);
      if (row.label_vi) m.set(row.label_vi.toLowerCase().trim(), row.code);
      const aliases = (row.meta && row.meta.aliases) || [];
      for (const a of aliases) m.set(String(a).toLowerCase().trim(), row.code);
    }
    aliasMaps[category] = m;
    console.log(`  loaded ${m.size.toString().padStart(4)} alias entries for category '${category}'`);
  }
  console.log('');

  // ── Resolvers ────────────────────────────────────────────────────
  function resolveSingle(raw, category) {
    if (!raw) return raw;
    const trimmed = String(raw).trim();
    if (!trimmed) return raw;
    return aliasMaps[category].get(trimmed.toLowerCase());  // undefined if unmapped
  }
  function resolveMulti(raw, category) {
    if (!raw) return { newValue: raw, orphans: [] };
    const pieces = String(raw).split(SPLIT_REGEX).map(s => s.trim()).filter(Boolean);
    if (pieces.length === 0) return { newValue: raw, orphans: [] };
    const orphans = [];
    const resolved = pieces.map(p => {
      const c = resolveSingle(p, category);
      if (c === undefined) { orphans.push(p); return p; }
      return c;
    });
    const seen = new Set();
    const deduped = resolved.filter(v => {
      const k = v.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { newValue: deduped.join(', '), orphans };
  }

  // ── Scan the students table ──────────────────────────────────────
  const fieldsToRead = ONLY_FIELD ? [ONLY_FIELD] : Object.keys(FIELD_MAP);
  // Pull full_name too so the CSV report is human-readable.
  const studentsRes = await pool.query(
    `SELECT unique_id, full_name, ${fieldsToRead.join(', ')} FROM students`
  );
  console.log(`Scanning ${studentsRes.rows.length} student rows...\n`);

  // ── Plan changes ─────────────────────────────────────────────────
  const changes = [];    // { uniqueId, fullName, field, category, oldValue, newValue }
  const orphans = [];    // { uniqueId, fullName, field, category, value }
  let noopCount = 0;

  for (const row of studentsRes.rows) {
    for (const field of fieldsToRead) {
      const { category, multiValue } = FIELD_MAP[field];
      const oldVal = row[field];
      if (oldVal == null || String(oldVal).trim() === '') continue;

      if (multiValue) {
        const { newValue, orphans: orphPieces } = resolveMulti(oldVal, category);
        if (newValue !== oldVal && newValue != null) {
          changes.push({ uniqueId: row.unique_id, fullName: row.full_name, field, category, oldValue: oldVal, newValue });
        } else {
          noopCount++;
        }
        for (const op of orphPieces) {
          orphans.push({ uniqueId: row.unique_id, fullName: row.full_name, field, category, value: op });
        }
      } else {
        const newVal = resolveSingle(oldVal, category);
        if (newVal === undefined) {
          orphans.push({ uniqueId: row.unique_id, fullName: row.full_name, field, category, value: oldVal });
        } else if (newVal !== oldVal) {
          changes.push({ uniqueId: row.unique_id, fullName: row.full_name, field, category, oldValue: oldVal, newValue: newVal });
        } else {
          noopCount++;
        }
      }
    }
  }

  // ── Console summary ──────────────────────────────────────────────
  console.log('─── Summary ──────────────────────────────────────');
  console.log(`  Changes planned:    ${changes.length}`);
  console.log(`  Orphans (no match): ${orphans.length}`);
  console.log(`  Already canonical:  ${noopCount}`);
  console.log('');

  // ── Write CSV reports ────────────────────────────────────────────
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

  const changesPath  = path.join(REPORT_DIR, 'normalize-changes.csv');
  const orphansPath  = path.join(REPORT_DIR, 'normalize-orphans.csv');
  const summaryPath  = path.join(REPORT_DIR, 'normalize-summary.csv');

  writeCsv(changesPath,
    ['uniqueId', 'fullName', 'field', 'category', 'oldValue', 'newValue'],
    changes
  );
  writeCsv(orphansPath,
    ['uniqueId', 'fullName', 'field', 'category', 'value'],
    orphans
  );

  // Summary: per-field counts of changes + orphans
  const summary = {};
  for (const c of changes) {
    if (!summary[c.field]) summary[c.field] = { field: c.field, category: c.category, changes: 0, orphans: 0 };
    summary[c.field].changes++;
  }
  for (const o of orphans) {
    if (!summary[o.field]) summary[o.field] = { field: o.field, category: o.category, changes: 0, orphans: 0 };
    summary[o.field].orphans++;
  }
  writeCsv(summaryPath,
    ['field', 'category', 'changes', 'orphans'],
    Object.values(summary).sort((a, b) => a.field.localeCompare(b.field))
  );

  console.log('CSV reports written:');
  console.log(`  ${changesPath}`);
  console.log(`  ${orphansPath}`);
  console.log(`  ${summaryPath}`);
  console.log('');
  console.log('Open these in Excel. (UTF-8 BOM included so Vietnamese diacritics display correctly.)');
  console.log('');

  if (!APPLY) {
    console.log(`Dry-run complete. Re-run with --apply to commit ${changes.length} change(s).`);
    await pool.end();
    return;
  }

  if (changes.length === 0) {
    console.log('Nothing to apply.');
    await pool.end();
    return;
  }

  // ── Apply ────────────────────────────────────────────────────────
  console.log(`Applying ${changes.length} change(s)...\n`);
  const client = await pool.connect();
  let applied = 0, failed = 0;
  try {
    await client.query('BEGIN');
    for (const c of changes) {
      try {
        await client.query(
          `UPDATE students SET ${c.field} = $1 WHERE unique_id = $2`,
          [c.newValue, c.uniqueId]
        );
        await client.query(
          `INSERT INTO audit_log
             (student_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
           VALUES ($1, $2, NOW(), $3, $4, $5, $6)`,
          [c.uniqueId, 'cleanup_script', c.field, String(c.oldValue), String(c.newValue), 'data_cleanup']
        );
        applied++;
      } catch (err) {
        console.error(`  FAILED ${c.uniqueId} ${c.field}: ${err.message}`);
        failed++;
      }
    }
    if (failed > 0) {
      console.log(`\n${failed} failure(s). Rolling back transaction.`);
      await client.query('ROLLBACK');
      process.exit(1);
    }
    await client.query('COMMIT');
    console.log(`✓ ${applied} change(s) committed and logged to audit_log.`);
    console.log(`  (See ${changesPath} for the full list.)`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('FATAL during apply, rolled back:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});

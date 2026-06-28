// scripts/applyCleanup.js
// ─────────────────────────────────────────────────────────────────────
// Three-part data cleanup, run in order:
//
//   PART 1: Add 5 new countries to lookup_values (Austria, Belgium,
//           India, Italy, Russia). Idempotent — re-runs are safe.
//
//   PART 2: Apply the cleanup plan from cleanup-plan.csv
//           - Auto-resolved changes from the first normalize run
//           - Orphan rows with the user's reviewed Column 6 decisions
//             (already normalized to canonical codes per the agreed rules:
//              England→UK, decimal GPA→tier, IELTS 7.5→7+, etc.)
//
//   PART 3: year_of_birth cleanup — set to NULL where value is
//           'chưa biết' (any case) or where it parses to a number < 1980.
//
// All writes go through a single transaction. Each change writes a row
// to audit_log with change_source='data_cleanup' and changed_by='cleanup_script'.
//
// Usage:
//   node scripts/applyCleanup.js                # dry-run (default)
//   node scripts/applyCleanup.js --apply        # commit everything
//
// Inputs:
//   scripts/cleanup-plan.csv  — the master plan (output of the user's review)
//
// Outputs:
//   ./cleanup-report/applied-plan.csv          — every action taken/planned
//   ./cleanup-report/year-of-birth-actions.csv — yob cleanup actions
//   ./cleanup-report/applied-summary.csv       — counts by stage/field/action
// ─────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const PLAN_CSV   = path.resolve(__dirname, 'cleanup-plan.csv');
const REPORT_DIR = path.resolve(__dirname, '../cleanup-report');

// ── New countries to add ───────────────────────────────────────────
const NEW_COUNTRIES = [
  { code: 'Austria', labelEn: null, labelVi: 'Áo',    meta: { region: 'Europe', aliases: ['AT', 'Austrian'] } },
  { code: 'Belgium', labelEn: null, labelVi: 'Bỉ',    meta: { region: 'Europe', aliases: ['BE', 'Belgian'] } },
  { code: 'India',   labelEn: null, labelVi: 'Ấn Độ', meta: { region: 'Asia',   aliases: ['IN', 'Indian'] } },
  { code: 'Italy',   labelEn: null, labelVi: 'Ý',     meta: { region: 'Europe', aliases: ['IT', 'Italian'] } },
  { code: 'Russia',  labelEn: null, labelVi: 'Nga',   meta: { region: 'Europe', aliases: ['RU', 'Russian'] } },
];

// ── Minimal CSV reader ─────────────────────────────────────────────
function parseCsv(text) {
  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let cur = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"' && field === '') { inQuotes = true; }
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else { field += c; }
    }
  }
  if (field !== '' || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows;
}

// ── CSV writer (UTF-8 + BOM for Excel) ─────────────────────────────
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
  if (!fs.existsSync(PLAN_CSV)) {
    console.error(`ERROR: cleanup-plan.csv not found at ${PLAN_CSV}`);
    console.error('Place the cleanup-plan.csv file next to this script and re-run.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  console.log(`Mode: ${APPLY ? 'APPLY (will write to DB)' : 'DRY-RUN (no changes will be made)'}`);
  console.log(`Connecting to ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}\n`);

  // ── Read and parse the plan CSV ──────────────────────────────────
  const planRows = parseCsv(fs.readFileSync(PLAN_CSV, 'utf8'));
  const header = planRows.shift();
  const idx = name => header.indexOf(name);
  const plan = planRows
    .filter(r => r.length === header.length)
    .map(r => ({
      stage:    r[idx('stage')],
      studentId: r[idx('studentId')],
      fullName: r[idx('fullName')],
      field:    r[idx('field')],
      oldValue: r[idx('oldValue')],
      newValue: r[idx('newValue')],
      action:   r[idx('action')],
      note:     r[idx('note')],
    }))
    .filter(p => p.studentId);  // skip blank rows

  console.log(`Plan loaded: ${plan.length} actions`);

  // ── Quick distribution snapshot ──────────────────────────────────
  const byField = new Map();
  for (const p of plan) {
    const key = `${p.field}|${p.action}`;
    byField.set(key, (byField.get(key) || 0) + 1);
  }
  console.log('\n─── Plan distribution ──────────────────────────');
  for (const [key, n] of [...byField.entries()].sort()) {
    const [field, action] = key.split('|');
    console.log(`  ${field.padEnd(22)} ${action.padEnd(8)} ${n}`);
  }
  console.log('');

  // ── Year-of-birth scan (PART 3 — query live) ─────────────────────
  const yobRes = await pool.query(
    `SELECT student_id, year_of_birth
     FROM students
     WHERE year_of_birth IS NOT NULL AND year_of_birth != ''`
  );
  const yobActions = [];
  for (const row of yobRes.rows) {
    const v = String(row.year_of_birth).trim();
    if (!v) continue;
    const lower = v.toLowerCase();
    // 'chưa biết' (and ASCII variant 'chua biet')
    if (lower === 'chưa biết' || lower === 'chua biet') {
      yobActions.push({ studentId: row.student_id, oldValue: v, reason: 'chưa biết' });
      continue;
    }
    const num = parseInt(v, 10);
    if (!isNaN(num) && num < 1980) {
      yobActions.push({ studentId: row.student_id, oldValue: v, reason: `year < 1980 (${num})` });
    }
  }
  console.log(`year_of_birth cleanup: ${yobActions.length} row(s) will be cleared\n`);

  // ── Write the dry-run/results reports ─────────────────────────────
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

  writeCsv(
    path.join(REPORT_DIR, 'applied-plan.csv'),
    ['stage', 'studentId', 'fullName', 'field', 'oldValue', 'newValue', 'action', 'note'],
    plan
  );
  writeCsv(
    path.join(REPORT_DIR, 'year-of-birth-actions.csv'),
    ['studentId', 'oldValue', 'reason'],
    yobActions
  );

  // Summary
  const summary = new Map();
  for (const p of plan) {
    const k = `${p.stage}|${p.field}|${p.action}`;
    summary.set(k, (summary.get(k) || 0) + 1);
  }
  const summaryRows = [...summary.entries()]
    .map(([k, count]) => { const [stage, field, action] = k.split('|'); return { stage, field, action, count }; })
    .sort((a, b) => a.field.localeCompare(b.field) || a.action.localeCompare(b.action));
  writeCsv(
    path.join(REPORT_DIR, 'applied-summary.csv'),
    ['stage', 'field', 'action', 'count'],
    summaryRows
  );

  console.log(`Reports written to ${REPORT_DIR}/`);
  console.log('');

  if (!APPLY) {
    console.log(`Dry-run complete. Would apply:`);
    console.log(`  - ${NEW_COUNTRIES.length} new country rows in lookup_values`);
    console.log(`  - ${plan.length} field updates from the plan`);
    console.log(`  - ${yobActions.length} year_of_birth clears`);
    console.log(`\nRe-run with --apply to commit.`);
    await pool.end();
    return;
  }

  // ── APPLY phase ──────────────────────────────────────────────────
  const client = await pool.connect();
  let countriesAdded = 0, planApplied = 0, yobApplied = 0, failures = 0;
  try {
    await client.query('BEGIN');

    // PART 1: Insert new countries (skip if already present)
    for (let i = 0; i < NEW_COUNTRIES.length; i++) {
      const c = NEW_COUNTRIES[i];
      try {
        const r = await client.query(
          `INSERT INTO lookup_values (category, code, label_en, label_vi, sort_order, meta)
           VALUES ('country', $1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (category, COALESCE(subcategory, ''), code) DO NOTHING
           RETURNING id`,
          [c.code, c.labelEn, c.labelVi, 24 + i, JSON.stringify(c.meta)]
        );
        if (r.rowCount > 0) countriesAdded++;
      } catch (err) {
        console.error(`  FAILED inserting ${c.code}: ${err.message}`);
        failures++;
      }
    }
    console.log(`PART 1: ${countriesAdded} new country/countries inserted into lookup_values`);

    // PART 2: Apply the plan
    for (const p of plan) {
      try {
        const newVal = p.action === 'clear' ? null : p.newValue;
        await client.query(
          `UPDATE students SET ${p.field} = $1 WHERE student_id = $2`,
          [newVal, p.studentId]
        );
        await client.query(
          `INSERT INTO audit_log
             (student_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
           VALUES ($1, $2, NOW(), $3, $4, $5, $6)`,
          [p.studentId, 'cleanup_script', p.field, String(p.oldValue ?? ''), String(newVal ?? ''), 'data_cleanup']
        );
        planApplied++;
      } catch (err) {
        console.error(`  FAILED ${p.studentId} ${p.field}: ${err.message}`);
        failures++;
      }
    }
    console.log(`PART 2: ${planApplied} field update(s) applied`);

    // PART 3: year_of_birth cleanup
    for (const a of yobActions) {
      try {
        await client.query(
          `UPDATE students SET year_of_birth = NULL WHERE student_id = $1`,
          [a.studentId]
        );
        await client.query(
          `INSERT INTO audit_log
             (student_id, changed_by, changed_at, field_name, old_value, new_value, change_source)
           VALUES ($1, $2, NOW(), $3, $4, $5, $6)`,
          [a.studentId, 'cleanup_script', 'year_of_birth', a.oldValue, '', 'data_cleanup']
        );
        yobApplied++;
      } catch (err) {
        console.error(`  FAILED yob ${a.studentId}: ${err.message}`);
        failures++;
      }
    }
    console.log(`PART 3: ${yobApplied} year_of_birth value(s) cleared`);

    if (failures > 0) {
      console.log(`\n${failures} failure(s). Rolling back transaction.`);
      await client.query('ROLLBACK');
      process.exit(1);
    }

    await client.query('COMMIT');
    console.log('\n✓ All three parts committed in a single transaction.');
    console.log(`  See ${REPORT_DIR}/ for per-row reports.`);
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

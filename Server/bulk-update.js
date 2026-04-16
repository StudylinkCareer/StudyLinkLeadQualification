// bulk-update.js
// Run from your Server/ folder:  node bulk-update.js --file=your-file.csv
// Add --dry-run flag to preview without writing to DB

require('dotenv').config({ path: '.env' });
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { parse } = require('csv-parse/sync');

// ── Config ────────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const fileArg = args.find(a => a.startsWith('--file='));
if (!fileArg) { console.error('Usage: node bulk-update.js --file=your-file.csv [--dry-run]'); process.exit(1); }
const CSV_FILE = fileArg.split('=')[1];

// All updatable columns (unique_id, created_at, updated_at are excluded)
const UPDATABLE_COLUMNS = [
  'full_name', 'contact_medium1', 'phone_country_code1', 'contact_detail1',
  'contact_medium2', 'phone_country_code2', 'contact_detail2', 'email',
  'hidden_phone_country_code', 'phone', 'study_plans', 'lead_source',
  'interaction', 'destination_country', 'timeline', 'process_application',
  'residency', 'year_of_birth', 'preferred_social', 'social_consent',
  'school_event', 'budget', 'scholarship_demand', 'english_level', 'gpa',
  'immigration_history', 'sponsor_income', 'income_evidence', 'study_plan_gap',
  'ultimate_objective', 'risk_score', 'stone_tier', 'headshot_url',
  'qr_code_image_url', 'mother_email', 'mother_full_name',
  'mother_phone_country_code', 'mother_phone', 'mother_contact_medium',
  'mother_contact_cc', 'mother_contact_detail', 'father_email',
  'father_full_name', 'father_phone_country_code', 'father_phone',
  'father_contact_medium', 'father_contact_cc', 'father_contact_detail',
  'counseling_notes', 'case_officer_notes', 'management_notes', 'status',
  'counselor', 'senior_counselor', 'presales', 'marketing_staff',
  'lead_status', 'close_date', 'confidence',
  'ocean_q1', 'ocean_q2', 'ocean_q3', 'ocean_q4', 'ocean_q5',
  'ocean_q6', 'ocean_q7', 'ocean_q8', 'ocean_q9', 'ocean_q10',
  'ocean_q11', 'ocean_q12', 'ocean_q13', 'ocean_q14', 'ocean_q15',
  'ocean_extraversion', 'ocean_agreeableness', 'ocean_conscientiousness',
  'ocean_neuroticism', 'ocean_openness', 'campaign_type', 'campaign_name',
  'campaign_start', 'campaign_end', 'ocean_archetype', 'ocean_narrative',
];

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Read CSV
  const csvPath = path.resolve(CSV_FILE);
  if (!fs.existsSync(csvPath)) { console.error(`File not found: ${csvPath}`); process.exit(1); }
  const records = parse(fs.readFileSync(csvPath), { columns: true, skip_empty_lines: true, trim: true });
  console.log(`\nLoaded ${records.length} rows from ${CSV_FILE}`);
  if (DRY_RUN) console.log('*** DRY RUN — no changes will be written ***\n');

  // Connect to DB
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  let updated = 0, skipped = 0, notFound = 0;

  for (const row of records) {
    const uniqueId = (row.unique_id || '').trim();
    if (!uniqueId) { console.warn('  [SKIP] Row missing unique_id'); skipped++; continue; }

    // Build SET clause — only columns that have a non-empty value in this row
    const setClauses = [];
    const values     = [];
    let   paramIdx   = 1;

    for (const col of UPDATABLE_COLUMNS) {
      if (!(col in row)) continue;           // column not in CSV at all
      const val = (row[col] || '').trim();
      if (val === '') continue;              // blank cell — skip, keep DB value

      setClauses.push(`${col} = $${paramIdx}`);
      values.push(val);
      paramIdx++;
    }

    if (setClauses.length === 0) {
      console.log(`  [SKIP] ${uniqueId} — no non-empty fields to update`);
      skipped++;
      continue;
    }

    // Always update updated_at
    setClauses.push(`updated_at = NOW()`);
    values.push(uniqueId);  // for WHERE clause

    const sql = `UPDATE students SET ${setClauses.join(', ')} WHERE unique_id = $${paramIdx} RETURNING unique_id`;

    if (DRY_RUN) {
      console.log(`  [DRY] Would update ${uniqueId}: ${setClauses.length - 1} field(s)`);
      updated++;
      continue;
    }

    try {
      const result = await pool.query(sql, values);
      if (result.rowCount === 0) {
        console.warn(`  [NOT FOUND] ${uniqueId}`);
        notFound++;
      } else {
        console.log(`  [OK] ${uniqueId} — ${setClauses.length - 1} field(s) updated`);
        updated++;
      }
    } catch (err) {
      console.error(`  [ERROR] ${uniqueId}: ${err.message}`);
      skipped++;
    }
  }

  await pool.end();
  console.log(`\n── Summary ──────────────────────`);
  console.log(`  Updated  : ${updated}`);
  console.log(`  Not found: ${notFound}`);
  console.log(`  Skipped  : ${skipped}`);
  console.log(`─────────────────────────────────\n`);
}

main().catch(err => { console.error(err); process.exit(1); });

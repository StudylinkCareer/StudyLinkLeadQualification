// Server/src/services/importData.js
//
// CHANGES vs previous version (3):
//   1. CSV file + optional batch office now come from CLI args:
//        node src/services/importData.js <csvFile> ["<office>"]
//      Run from the Server/ directory (so dotenv finds .env).
//      Examples:
//        node src/services/importData.js leads_wise_da_nang.csv "Da Nang"
//        node src/services/importData.js mixed_batch.csv          <-- office left blank, tag by province after
//   2. Every imported lead lands in the distribution pool:
//        distribution_status = 'pool', office = <arg or NULL>
//   3. INSERT now has ON CONFLICT (unique_id) DO NOTHING so a re-run
//      never duplicates existing leads.
//
// NOTE: ON CONFLICT (unique_id) requires a UNIQUE constraint on
//       students.unique_id. If you get "no unique or exclusion constraint
//       matching ON CONFLICT", run once:
//         ALTER TABLE students ADD CONSTRAINT students_unique_id_key UNIQUE (unique_id);

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 1,
  connectionTimeoutMillis: 15000,
});

// ── CLI args ────────────────────────────────────────────────
const csvArg      = process.argv[2];
const batchOffice = process.argv[3] || null;   // NULL = tag office by province later
const csvFile = csvArg
  ? (path.isAbsolute(csvArg) ? csvArg : path.join(process.cwd(), csvArg))
  : path.join(__dirname, '../../production_data.csv');

const INSERT_SQL = `
  INSERT INTO students (
    student_id, full_name,
    contact_medium1, phone_country_code1, contact_detail1,
    contact_medium2, phone_country_code2, contact_detail2,
    email, hidden_phone_country_code, phone,
    study_plans, lead_source, interaction, destination_country,
    timeline, process_application, residency, year_of_birth,
    preferred_social, social_consent, school_event, budget,
    scholarship_demand, english_level, gpa, immigration_history,
    sponsor_income, income_evidence, study_plan_gap, ultimate_objective,
    risk_score, stone_tier, headshot_url, qr_code_image_url,
    mother_email, mother_full_name, mother_phone_country_code, mother_phone,
    mother_contact_medium, mother_contact_cc, mother_contact_detail,
    father_email, father_full_name, father_phone_country_code, father_phone,
    father_contact_medium, father_contact_cc, father_contact_detail,
    counseling_notes, case_officer_notes, management_notes,
    created_at, updated_at, status,
    office, distribution_status
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
    $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
    $29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,
    $42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,
    $56,$57
  )
  ON CONFLICT (student_id) DO NOTHING
`;

function rowValues(row, office) {
  return [
    row.unique_id, row.full_name,
    row.contact_medium1, row.phone_country_code1, row.contact_detail1,
    row.contact_medium2, row.phone_country_code2, row.contact_detail2,
    row.email, row.hidden_phone_country_code, row.phone,
    row.study_plans, row.lead_source, row.interaction, row.destination_country,
    row.timeline, row.process_application, row.residency, row.year_of_birth,
    row.preferred_social, row.social_consent, row.school_event, row.budget,
    row.scholarship_demand, row.english_level, row.gpa, row.immigration_history,
    row.sponsor_income, row.income_evidence, row.study_plan_gap, row.ultimate_objective,
    row.risk_score, row.stone_tier, row.headshot_url, row.qr_code_image_url,
    row.mother_email, row.mother_full_name, row.mother_phone_country_code, row.mother_phone,
    row.mother_contact_medium, row.mother_contact_cc, row.mother_contact_detail,
    row.father_email, row.father_full_name, row.father_phone_country_code, row.father_phone,
    row.father_contact_medium, row.father_contact_cc, row.father_contact_detail,
    row.counseling_notes, row.case_officer_notes, row.management_notes,
    row.created_at || new Date(), row.updated_at || new Date(), row.status || 'Active',
    office,            // $56 — batch office (or NULL to tag later)
    'pool',            // $57 — every imported lead enters the distribution pool
  ];
}

async function importData() {
  if (!fs.existsSync(csvFile)) {
    console.error(`CSV not found: ${csvFile}`);
    process.exit(1);
  }
  console.log(`CSV:    ${csvFile}`);
  console.log(`Office: ${batchOffice || '(none — tag by province after import)'}`);

  const records = await new Promise((resolve, reject) => {
    const out = [];
    fs.createReadStream(csvFile)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true, bom: true }))
      .on('data', (row) => out.push(row))
      .on('end', () => resolve(out))
      .on('error', reject);
  });

  console.log(`Found ${records.length} records to import`);

  const client = await pool.connect();
  console.log('Connected to database');

  let success = 0;
  let skipped = 0;   // ON CONFLICT no-ops (already present)
  let failed = 0;

  try {
    for (const row of records) {
      try {
        const r = await client.query(INSERT_SQL, rowValues(row, batchOffice));
        if (r.rowCount === 1) success++; else skipped++;
      } catch (err) {
        console.error(`Failed ${row.unique_id || row.full_name}: ${err.message}`);
        failed++;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`Imported: ${success} | Skipped (already exist): ${skipped} | Failed: ${failed}`);
  console.log(`These ${success} leads are now in the pool (distribution_status='pool').`);
}

importData().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

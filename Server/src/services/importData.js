require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const pool = require('./db');

const csvFile = path.join(__dirname, '../../production_data.csv');

async function importData() {
  const records = [];

  await new Promise((resolve, reject) => {
    fs.createReadStream(csvFile)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }))
      .on('data', (row) => records.push(row))
      .on('end', resolve)
      .on('error', reject);
  });

  console.log(`📋 Found ${records.length} records to import`);

  let success = 0;
  let failed = 0;

  for (const row of records) {
    try {
      await pool.query(`
        INSERT INTO students (
          unique_id, full_name,
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
          created_at, updated_at, status
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
          $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
          $29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,
          $42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55
        )
      `, [
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
        row.created_at || new Date(), row.updated_at || new Date(), row.status || 'Active'
      ]);
      success++;
    } catch (err) {
      console.error(`❌ Failed row ${row.unique_id}: ${err.message}`);
      failed++;
    }
  }

  console.log(`✅ Imported: ${success} | ❌ Failed: ${failed}`);
  pool.end();
}

importData();
// scripts/addColumnLabels.js
// ─────────────────────────────────────────────────────────────────────
// Seeds column-header labels into `lookup_values` so the Leads table's
// column headers can be translated to Vietnamese at render time.
//
// Storage:
//   category = 'column_label'
//   code     = the field name used by the column (matches permission_fields.field_name)
//   label_en = English header (kept here for editing context — the
//              permission_fields.label is still the authoritative English source)
//   label_vi = Vietnamese translation
//
// Idempotent — re-running updates existing rows with the latest values.
// You can correct any wording later via the admin UI (Step 5).
//
// Usage:
//   node scripts/addColumnLabels.js
// ─────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const COLUMN_LABELS = [
  // Identity / core
  { code: 'fullName',            labelEn: 'Name',              labelVi: 'Họ và tên' },
  { code: 'uniqueId',            labelEn: 'ID',                labelVi: 'Mã hồ sơ' },
  { code: 'email',               labelEn: 'Email',             labelVi: 'Email' },
  { code: 'phone',               labelEn: 'Phone',             labelVi: 'Số điện thoại' },
  { code: 'facebookProfile',     labelEn: 'Facebook',          labelVi: 'Facebook' },

  // Lead pipeline
  { code: 'leadStatus',          labelEn: 'Status',            labelVi: 'Tình trạng' },
  { code: 'stoneTier',           labelEn: 'Stone',             labelVi: 'Hạng đá' },
  { code: 'leadSource',          labelEn: 'Source',            labelVi: 'Nguồn khách hàng' },
  { code: 'interaction',         labelEn: 'Interaction',       labelVi: 'Mức độ tương tác' },
  { code: 'studyPlans',          labelEn: 'Study Plans',       labelVi: 'Kế hoạch học tập' },
  { code: 'destinationCountry',  labelEn: 'Destination',       labelVi: 'Điểm đến' },
  { code: 'timeline',            labelEn: 'Timeline',          labelVi: 'Thời gian dự kiến' },
  { code: 'englishLevel',        labelEn: 'English',           labelVi: 'Tiếng Anh' },
  { code: 'gpa',                 labelEn: 'GPA',               labelVi: 'Điểm TB' },
  { code: 'budget',              labelEn: 'Budget',            labelVi: 'Ngân sách' },
  { code: 'confidence',          labelEn: 'Confidence',        labelVi: 'Mức tin cậy' },

  // Staff
  { code: 'counselor',           labelEn: 'Counselor',         labelVi: 'Tư vấn viên' },
  { code: 'seniorCounselor',     labelEn: 'Sr. Counselor',     labelVi: 'Tư vấn cấp cao' },
  { code: 'presales',            labelEn: 'Pre-Sales',         labelVi: 'Tiền bán hàng' },
  { code: 'marketingStaff',      labelEn: 'Marketing',         labelVi: 'Tiếp thị' },

  // Personal
  { code: 'yearOfBirth',         labelEn: 'Year of Birth',     labelVi: 'Năm sinh' },
  { code: 'residency',           labelEn: 'Residency',         labelVi: 'Nơi cư trú' },
  { code: 'schoolEvent',         labelEn: 'School/Event',      labelVi: 'Trường / Sự kiện' },
  { code: 'preferredSocial',     labelEn: 'Social Platform',   labelVi: 'Mạng xã hội' },
  { code: 'socialConsent',       labelEn: 'Connect With Us',   labelVi: 'Đồng ý kết nối' },

  // Self assessment
  { code: 'scholarshipDemand',   labelEn: 'Scholarship',       labelVi: 'Học bổng' },
  { code: 'immigrationHistory',  labelEn: 'Immigration',       labelVi: 'Lịch sử di trú' },
  { code: 'sponsorIncome',       labelEn: 'Sponsor Income',    labelVi: 'Thu nhập bảo trợ' },
  { code: 'incomeEvidence',      labelEn: 'Income Evidence',   labelVi: 'Chứng từ thu nhập' },
  { code: 'studyPlanGap',        labelEn: 'Study Plan Gap',    labelVi: 'Khoảng trống học tập' },
  { code: 'ultimateObjective',   labelEn: 'Objective',         labelVi: 'Mục tiêu cuối' },
  { code: 'riskScore',           labelEn: 'Risk Score',        labelVi: 'Chỉ số rủi ro' },

  // OCEAN
  { code: 'oceanExtraversion',     labelEn: 'Extraversion',       labelVi: 'Hướng ngoại' },
  { code: 'oceanAgreeableness',    labelEn: 'Agreeableness',      labelVi: 'Dễ chịu' },
  { code: 'oceanConscientiousness',labelEn: 'Conscientiousness',  labelVi: 'Tận tâm' },
  { code: 'oceanNeuroticism',      labelEn: 'Neuroticism',        labelVi: 'Bất ổn cảm xúc' },
  { code: 'oceanOpenness',         labelEn: 'Openness',           labelVi: 'Cởi mở' },

  // Family
  { code: 'motherFullName',         labelEn: 'Mother Name',       labelVi: 'Tên Mẹ' },
  { code: 'motherEmail',            labelEn: 'Mother Email',      labelVi: 'Email Mẹ' },
  { code: 'motherContactMedium',    labelEn: 'Mother Medium',     labelVi: 'PT liên hệ Mẹ' },
  { code: 'motherContactDetail',    labelEn: 'Mother Contact',    labelVi: 'Liên hệ Mẹ' },
  { code: 'fatherFullName',         labelEn: 'Father Name',       labelVi: 'Tên Bố' },
  { code: 'fatherEmail',            labelEn: 'Father Email',      labelVi: 'Email Bố' },
  { code: 'fatherContactMedium',    labelEn: 'Father Medium',     labelVi: 'PT liên hệ Bố' },
  { code: 'fatherContactDetail',    labelEn: 'Father Contact',    labelVi: 'Liên hệ Bố' },

  // Campaign
  { code: 'campaignType',        labelEn: 'Campaign Type',     labelVi: 'Loại sự kiện' },
  { code: 'campaignName',        labelEn: 'Campaign',          labelVi: 'Sự kiện' },
  { code: 'campaignStart',       labelEn: 'Camp. Start',       labelVi: 'Bắt đầu' },
  { code: 'campaignEnd',         labelEn: 'Camp. End',         labelVi: 'Kết thúc' },

  // Dates / metadata
  { code: 'createdAt',           labelEn: 'Created',           labelVi: 'Ngày tạo' },
  { code: 'updatedAt',           labelEn: 'Updated',           labelVi: 'Cập nhật' },
  { code: 'closeDate',           labelEn: 'Close Date',        labelVi: 'Ngày đóng' },
  { code: 'age',                 labelEn: 'Age',               labelVi: 'Tuổi hồ sơ' },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL not set in .env');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  console.log(`Connecting to ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`Seeding ${COLUMN_LABELS.length} column label translations...\n`);

  const client = await pool.connect();
  let inserted = 0, updated = 0;
  try {
    await client.query('BEGIN');
    for (let i = 0; i < COLUMN_LABELS.length; i++) {
      const c = COLUMN_LABELS[i];
      const res = await client.query(
        `INSERT INTO lookup_values (category, code, label_en, label_vi, sort_order)
         VALUES ('column_label', $1, $2, $3, $4)
         ON CONFLICT (category, COALESCE(subcategory, ''), code) DO UPDATE
           SET label_en = EXCLUDED.label_en,
               label_vi = EXCLUDED.label_vi,
               sort_order = EXCLUDED.sort_order
         RETURNING (xmax = 0) AS inserted`,
        [c.code, c.labelEn, c.labelVi, i]
      );
      if (res.rows[0].inserted) inserted++; else updated++;
    }
    await client.query('COMMIT');
    console.log(`✓ Done. ${inserted} inserted, ${updated} updated.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

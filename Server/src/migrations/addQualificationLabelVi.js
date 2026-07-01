// Server/src/migrations/addQualificationLabelVi.js
// ---------------------------------------------------------------------------
// Adds a Vietnamese label column to event_qualification_fields and populates it,
// so the student-facing /profile ("Tìm hiểu về bạn") page shows the QUESTION
// labels in Vietnamese. (Answer options already come from lookup_values.label_vi;
// buildCheckinFields auto-detects this label_vi column once it exists.)
//
// Idempotent (ADD COLUMN IF NOT EXISTS + UPDATE by field_key). Safe to re-run.
//   node src/migrations/addQualificationLabelVi.js              # dev
//   node src/migrations/addQualificationLabelVi.js --allow-remote  # PROD
// ---------------------------------------------------------------------------

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const url = process.env.DATABASE_URL || '';
if (!process.argv.includes('--allow-remote') && !(url.includes('localhost') && url.includes('studylink_dev'))) {
  console.error('✗ Refusing to run: DATABASE_URL is not localhost/studylink_dev. Use --allow-remote for a deliberate PROD run.');
  process.exit(1);
}

// field_key -> Vietnamese label. Adjust wording here and re-run if needed.
const VI = {
  email:               'Email',
  phone:               'Số điện thoại',
  year_of_birth:       'Năm sinh',
  lead_source:         'Nguồn thông tin',
  residency:           'Nơi cư trú',
  study_plans:         'Ước mơ',
  preferred_social:    'Mạng xã hội (Zalo)',
  social_consent:      'Kết nối với chúng tôi',
  destination_country: 'Quốc gia muốn du học',
  timeline:            'Thời gian dự kiến',
  process_application: 'Tiến trình hồ sơ',
  budget:              'Ngân sách',
  scholarship_demand:  'Nhu cầu học bổng',
  english_level:       'Trình độ tiếng Anh',
  gpa:                 'GPA (Điểm trung bình)',
  immigration_history: 'Lịch sử di trú',
  sponsor_income:      'Thu nhập người bảo trợ',
  income_evidence:     'Chứng minh thu nhập',
  study_plan_gap:      'Kế hoạch học tập & thời gian gián đoạn',
  ultimate_objective:  'Mục tiêu sau khi du học',
  major:               'Ngành học',
};

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE event_qualification_fields ADD COLUMN IF NOT EXISTS label_vi text`);
    let n = 0;
    for (const [key, vi] of Object.entries(VI)) {
      const r = await client.query(
        `UPDATE event_qualification_fields SET label_vi = $1 WHERE field_key = $2`,
        [vi, key]
      );
      n += r.rowCount;
    }
    await client.query('COMMIT');
    console.log(`✓ label_vi column ensured; ${n} field label(s) set to Vietnamese.`);

    const check = await client.query(
      `SELECT field_key, label, label_vi FROM event_qualification_fields WHERE is_required = true ORDER BY sort_order`
    );
    console.log('\nRequired questions now:');
    check.rows.forEach(r => console.log(`  ${String(r.field_key).padEnd(20)} ${r.label}  ->  ${r.label_vi || '(none)'}`));
    console.log('\nDone. The /profile page will show these once the (already-deployed) server reads the column.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✗ Failed, rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });

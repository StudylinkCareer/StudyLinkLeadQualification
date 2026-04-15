// server/src/models/Student.js
// REWRITE: Migrated from Google Sheets to PostgreSQL
//   - No googleSheets dependency
//   - Explicit snake_case ↔ camelCase column map for all 86 columns
//   - All functions use pg Pool directly (same pattern as Staff.js)
//   - generateUniqueId() queries DB instead of Sheets for sequence numbers
//   - uploadPhotos() stores base64 data URLs directly in DB text columns

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── Complete column map: DB snake_case ↔ JS camelCase ─────────
// Explicit mapping avoids edge cases (e.g. motherContactCC, oceanQ1-15)
const COLUMNS = [
  { db: 'unique_id',                 js: 'uniqueId' },
  { db: 'full_name',                 js: 'fullName' },
  { db: 'contact_medium1',           js: 'contactMedium1' },
  { db: 'phone_country_code1',       js: 'phoneCountryCode1' },
  { db: 'contact_detail1',           js: 'contactDetail1' },
  { db: 'contact_medium2',           js: 'contactMedium2' },
  { db: 'phone_country_code2',       js: 'phoneCountryCode2' },
  { db: 'contact_detail2',           js: 'contactDetail2' },
  { db: 'email',                     js: 'email' },
  { db: 'hidden_phone_country_code', js: 'hiddenPhoneCountryCode' },
  { db: 'phone',                     js: 'phone' },
  { db: 'study_plans',               js: 'studyPlans' },
  { db: 'lead_source',               js: 'leadSource' },
  { db: 'interaction',               js: 'interaction' },
  { db: 'destination_country',       js: 'destinationCountry' },
  { db: 'timeline',                  js: 'timeline' },
  { db: 'process_application',       js: 'processApplication' },
  { db: 'residency',                 js: 'residency' },
  { db: 'year_of_birth',             js: 'yearOfBirth' },
  { db: 'preferred_social',          js: 'preferredSocial' },
  { db: 'social_consent',            js: 'socialConsent' },
  { db: 'school_event',              js: 'schoolEvent' },
  { db: 'budget',                    js: 'budget' },
  { db: 'scholarship_demand',        js: 'scholarshipDemand' },
  { db: 'english_level',             js: 'englishLevel' },
  { db: 'gpa',                       js: 'gpa' },
  { db: 'immigration_history',       js: 'immigrationHistory' },
  { db: 'sponsor_income',            js: 'sponsorIncome' },
  { db: 'income_evidence',           js: 'incomeEvidence' },
  { db: 'study_plan_gap',            js: 'studyPlanGap' },
  { db: 'ultimate_objective',        js: 'ultimateObjective' },
  { db: 'risk_score',                js: 'riskScore' },
  { db: 'stone_tier',                js: 'stoneTier' },
  { db: 'headshot_url',              js: 'headshotUrl' },
  { db: 'qr_code_image_url',         js: 'qrCodeImageUrl' },
  { db: 'mother_email',              js: 'motherEmail' },
  { db: 'mother_full_name',          js: 'motherFullName' },
  { db: 'mother_phone_country_code', js: 'motherPhoneCountryCode' },
  { db: 'mother_phone',              js: 'motherPhone' },
  { db: 'mother_contact_medium',     js: 'motherContactMedium' },
  { db: 'mother_contact_cc',         js: 'motherContactCC' },
  { db: 'mother_contact_detail',     js: 'motherContactDetail' },
  { db: 'father_email',              js: 'fatherEmail' },
  { db: 'father_full_name',          js: 'fatherFullName' },
  { db: 'father_phone_country_code', js: 'fatherPhoneCountryCode' },
  { db: 'father_phone',              js: 'fatherPhone' },
  { db: 'father_contact_medium',     js: 'fatherContactMedium' },
  { db: 'father_contact_cc',         js: 'fatherContactCC' },
  { db: 'father_contact_detail',     js: 'fatherContactDetail' },
  { db: 'counseling_notes',          js: 'counselingNotes' },
  { db: 'case_officer_notes',        js: 'caseOfficerNotes' },
  { db: 'management_notes',          js: 'managementNotes' },
  { db: 'created_at',                js: 'createdAt' },
  { db: 'updated_at',                js: 'updatedAt' },
  { db: 'status',                    js: 'status' },
  { db: 'counselor',                 js: 'counselor' },
  { db: 'senior_counselor',          js: 'seniorCounselor' },
  { db: 'presales',                  js: 'presales' },
  { db: 'marketing_staff',           js: 'marketingStaff' },
  { db: 'lead_status',               js: 'leadStatus' },
  { db: 'close_date',                js: 'closeDate' },
  { db: 'confidence',                js: 'confidence' },
  { db: 'ocean_q1',                  js: 'oceanQ1' },
  { db: 'ocean_q2',                  js: 'oceanQ2' },
  { db: 'ocean_q3',                  js: 'oceanQ3' },
  { db: 'ocean_q4',                  js: 'oceanQ4' },
  { db: 'ocean_q5',                  js: 'oceanQ5' },
  { db: 'ocean_q6',                  js: 'oceanQ6' },
  { db: 'ocean_q7',                  js: 'oceanQ7' },
  { db: 'ocean_q8',                  js: 'oceanQ8' },
  { db: 'ocean_q9',                  js: 'oceanQ9' },
  { db: 'ocean_q10',                 js: 'oceanQ10' },
  { db: 'ocean_q11',                 js: 'oceanQ11' },
  { db: 'ocean_q12',                 js: 'oceanQ12' },
  { db: 'ocean_q13',                 js: 'oceanQ13' },
  { db: 'ocean_q14',                 js: 'oceanQ14' },
  { db: 'ocean_q15',                 js: 'oceanQ15' },
  { db: 'ocean_extraversion',        js: 'oceanExtraversion' },
  { db: 'ocean_agreeableness',       js: 'oceanAgreeableness' },
  { db: 'ocean_conscientiousness',   js: 'oceanConscientiousness' },
  { db: 'ocean_neuroticism',         js: 'oceanNeuroticism' },
  { db: 'ocean_openness',            js: 'oceanOpenness' },
  { db: 'campaign_type',             js: 'campaignType' },
  { db: 'campaign_name',             js: 'campaignName' },
  { db: 'campaign_start',            js: 'campaignStart' },
  { db: 'campaign_end',              js: 'campaignEnd' },
];

// Lookup maps built from COLUMNS
const DB_TO_JS = Object.fromEntries(COLUMNS.map(c => [c.db, c.js]));
const JS_TO_DB = Object.fromEntries(COLUMNS.map(c => [c.js, c.db]));

// ── Convert a DB row (snake_case) to a JS object (camelCase) ──
function rowToJs(row) {
  if (!row) return null;
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    result[DB_TO_JS[key] || key] = value;
  }
  return result;
}

// ── Timezone helper (Indochina / Ho Chi Minh) ─────────────────
function toIndochinaISO() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).replace(' ', 'T') + '+07:00';
}

// ── Validation ────────────────────────────────────────────────
const REQUIRED_FIELDS = [];

function validate(data, partial = false) {
  const errors = [];
  if (!partial) {
    for (const field of REQUIRED_FIELDS) {
      if (!data[field] || (typeof data[field] === 'string' && !data[field].trim())) {
        errors.push(`${field} is required`);
      }
    }
  }
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.push('Invalid email format');
  }
  return errors;
}

// ── Generate unique ID: YYYYMMDD-NN ──────────────────────────
async function generateUniqueId() {
  const now = new Date();
  const ict = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const y   = ict.getFullYear();
  const m   = String(ict.getMonth() + 1).padStart(2, '0');
  const d   = String(ict.getDate()).padStart(2, '0');
  const prefix = `${y}${m}${d}`;

  // Find the highest sequence number used today
  const result = await pool.query(
    `SELECT unique_id FROM students WHERE unique_id LIKE $1 ORDER BY unique_id DESC LIMIT 1`,
    [`${prefix}-%`]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const parts = result.rows[0].unique_id.split('-');
    seq = parseInt(parts[parts.length - 1], 10) + 1;
  }

  return `${prefix}-${String(seq).padStart(2, '0')}`;
}

// ── CREATE ────────────────────────────────────────────────────
async function create(data) {
  const errors = validate(data);
  if (errors.length) throw new Error(errors.join(', '));

  const uniqueId = await generateUniqueId();
  const now = toIndochinaISO();

  // Build full JS record with defaults
  const record = {
    uniqueId,
    fullName:               data.fullName               || '',
    contactMedium1:         data.contactMedium1         || '',
    phoneCountryCode1:      data.phoneCountryCode1      || '',
    contactDetail1:         data.contactDetail1         || '',
    contactMedium2:         data.contactMedium2         || '',
    phoneCountryCode2:      data.phoneCountryCode2      || '',
    contactDetail2:         data.contactDetail2         || '',
    email:                  data.email                  || '',
    hiddenPhoneCountryCode: data.hiddenPhoneCountryCode || data.phoneCountryCode || '',
    phone:                  data.phone                  || '',
    studyPlans:             data.studyPlans             || '',
    leadSource:             data.leadSource             || '',
    interaction:            data.interaction            || '',
    destinationCountry:     Array.isArray(data.destinationCountry)
                              ? data.destinationCountry.join(', ')
                              : data.destinationCountry || '',
    timeline:               data.timeline               || '',
    processApplication:     data.processApplication     || '',
    residency:              data.residency              || data.placeOfResidence || '',
    yearOfBirth:            data.yearOfBirth            || '',
    preferredSocial:        data.preferredSocial        || '',
    socialConsent:          data.socialConsent          || data.connectWithYou || '',
    schoolEvent:            data.schoolEvent            || '',
    budget:                 data.budget                 || '',
    scholarshipDemand:      data.scholarshipDemand      || '',
    englishLevel:           data.englishLevel           || '',
    gpa:                    data.gpa                    || '',
    immigrationHistory:     data.immigrationHistory     || '',
    sponsorIncome:          data.sponsorIncome          || '',
    incomeEvidence:         data.incomeEvidence         || '',
    studyPlanGap:           data.studyPlanGap           || '',
    ultimateObjective:      data.ultimateObjective      || '',
    riskScore:              data.riskScore              || '',
    stoneTier:              data.stoneTier              || '',
    headshotUrl:            data.headshotUrl            || '',
    qrCodeImageUrl:         data.qrCodeImageUrl         || '',
    motherEmail:            data.motherEmail            || '',
    motherFullName:         data.motherFullName         || '',
    motherPhoneCountryCode: data.motherPhoneCountryCode || '',
    motherPhone:            data.motherPhone            || '',
    motherContactMedium:    data.motherContactMedium    || '',
    motherContactCC:        data.motherContactCC        || '',
    motherContactDetail:    data.motherContactDetail    || '',
    fatherEmail:            data.fatherEmail            || '',
    fatherFullName:         data.fatherFullName         || '',
    fatherPhoneCountryCode: data.fatherPhoneCountryCode || '',
    fatherPhone:            data.fatherPhone            || '',
    fatherContactMedium:    data.fatherContactMedium    || '',
    fatherContactCC:        data.fatherContactCC        || '',
    fatherContactDetail:    data.fatherContactDetail    || '',
    counselingNotes:        data.counselingNotes        || '',
    caseOfficerNotes:       data.caseOfficerNotes       || '',
    managementNotes:        data.managementNotes        || '',
    createdAt:              now,
    updatedAt:              now,
    status:                 'Active',
    counselor:              data.counselor              || '',
    seniorCounselor:        data.seniorCounselor        || '',
    presales:               data.presales               || '',
    marketingStaff:         data.marketingStaff         || '',
    leadStatus:             data.leadStatus             || 'New',
    closeDate:              data.closeDate              || null,
    confidence:             data.confidence             || '',
    oceanQ1:                data.oceanQ1                || null,
    oceanQ2:                data.oceanQ2                || null,
    oceanQ3:                data.oceanQ3                || null,
    oceanQ4:                data.oceanQ4                || null,
    oceanQ5:                data.oceanQ5                || null,
    oceanQ6:                data.oceanQ6                || null,
    oceanQ7:                data.oceanQ7                || null,
    oceanQ8:                data.oceanQ8                || null,
    oceanQ9:                data.oceanQ9                || null,
    oceanQ10:               data.oceanQ10               || null,
    oceanQ11:               data.oceanQ11               || null,
    oceanQ12:               data.oceanQ12               || null,
    oceanQ13:               data.oceanQ13               || null,
    oceanQ14:               data.oceanQ14               || null,
    oceanQ15:               data.oceanQ15               || null,
    oceanExtraversion:      data.oceanExtraversion      || null,
    oceanAgreeableness:     data.oceanAgreeableness     || null,
    oceanConscientiousness: data.oceanConscientiousness || null,
    oceanNeuroticism:       data.oceanNeuroticism       || null,
    oceanOpenness:          data.oceanOpenness          || null,
    campaignType:           data.campaignType           || '',
    campaignName:           data.campaignName           || '',
    campaignStart:          data.campaignStart          || null,
    campaignEnd:            data.campaignEnd            || null,
  };

  // Build INSERT using COLUMNS map to guarantee correct DB column order
  const dbCols = COLUMNS.map(c => c.db);
  const values = COLUMNS.map(c => record[c.js] !== undefined ? record[c.js] : null);
  const placeholders = values.map((_, i) => `$${i + 1}`);

  await pool.query(
    `INSERT INTO students (${dbCols.join(', ')}) VALUES (${placeholders.join(', ')})`,
    values
  );

  return record;
}

// ── FIND BY EMAIL ─────────────────────────────────────────────
async function findByEmail(email) {
  const result = await pool.query(
    `SELECT * FROM students WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );
  if (!result.rows.length) return null;
  return { data: rowToJs(result.rows[0]) };
}

// ── FIND BY ID ────────────────────────────────────────────────
async function findById(uniqueId) {
  const result = await pool.query(
    `SELECT * FROM students WHERE unique_id = $1 LIMIT 1`,
    [uniqueId]
  );
  if (!result.rows.length) return null;
  return { data: rowToJs(result.rows[0]) };
}

// ── UPDATE ────────────────────────────────────────────────────
async function update(uniqueId, data) {
  const setClauses = [];
  const values     = [];
  let   paramIdx   = 1;

  for (const [jsKey, value] of Object.entries(data)) {
    if (jsKey === 'uniqueId' || jsKey === 'createdAt') continue;
    const dbCol = JS_TO_DB[jsKey];
    if (!dbCol) continue; // ignore unknown fields

    let val = value;
    if (jsKey === 'destinationCountry' && Array.isArray(value)) {
      val = value.join(', ');
    }

    setClauses.push(`${dbCol} = $${paramIdx}`);
    values.push(val ?? null);
    paramIdx++;
  }

  if (!setClauses.length) {
    // Nothing to update — fetch and return current record
    return (await findById(uniqueId))?.data;
  }

  // Always bump updated_at
  setClauses.push(`updated_at = $${paramIdx}`);
  values.push(toIndochinaISO());
  paramIdx++;

  values.push(uniqueId); // WHERE clause param

  const result = await pool.query(
    `UPDATE students SET ${setClauses.join(', ')} WHERE unique_id = $${paramIdx} RETURNING *`,
    values
  );

  if (!result.rows.length) throw new Error('Student not found');
  return rowToJs(result.rows[0]);
}

// ── CHECK DUPLICATES ──────────────────────────────────────────
async function checkDuplicates(email, phone) {
  const conditions = [];
  const values     = [];

  if (email) {
    conditions.push(`LOWER(email) = LOWER($${values.length + 1})`);
    values.push(email);
  }
  if (phone) {
    conditions.push(`phone = $${values.length + 1}`);
    values.push(phone);
  }

  if (!conditions.length) return [];

  const result = await pool.query(
    `SELECT * FROM students WHERE ${conditions.join(' OR ')}`,
    values
  );

  return result.rows.map(rowToJs);
}

// ── DEACTIVATE RECORDS ────────────────────────────────────────
async function deactivateRecords(uniqueIds) {
  const placeholders = uniqueIds.map((_, i) => `$${i + 1}`);
  await pool.query(
    `UPDATE students SET status = 'Inactive', updated_at = NOW()
     WHERE unique_id IN (${placeholders.join(', ')})`,
    uniqueIds
  );
  return { deactivated: uniqueIds };
}

// ── UPLOAD PHOTOS ─────────────────────────────────────────────
// Stores base64 data URLs directly in DB text columns.
// These render fine in <img src="..."> tags.
// TODO: migrate to cloud storage (S3/Cloudinary) for production efficiency.
async function uploadPhotos(uniqueId, { headshot, qrCodeImage }) {
  const setClauses = [];
  const values     = [];

  if (headshot) {
    values.push(headshot);
    setClauses.push(`headshot_url = $${values.length}`);
  }
  if (qrCodeImage) {
    values.push(qrCodeImage);
    setClauses.push(`qr_code_image_url = $${values.length}`);
  }

  if (!setClauses.length) return {};

  values.push(uniqueId);
  const result = await pool.query(
    `UPDATE students SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE unique_id = $${values.length}
     RETURNING headshot_url, qr_code_image_url`,
    values
  );

  if (!result.rows.length) throw new Error('Student not found');
  return {
    headshotUrl:    result.rows[0].headshot_url,
    qrCodeImageUrl: result.rows[0].qr_code_image_url,
  };
}

// ── SEARCH (replaces sheets.searchStudents) ───────────────────
async function search(query) {
  if (!query) {
    const result = await pool.query(
      `SELECT * FROM students ORDER BY created_at DESC`
    );
    return result.rows.map(rowToJs);
  }

  const q = `%${query}%`;
  const result = await pool.query(
    `SELECT * FROM students
     WHERE full_name  ILIKE $1
        OR email      ILIKE $1
        OR phone      ILIKE $1
        OR unique_id  ILIKE $1
     ORDER BY created_at DESC`,
    [q]
  );
  return result.rows.map(rowToJs);
}

module.exports = {
  create,
  findByEmail,
  findById,
  update,
  checkDuplicates,
  deactivateRecords,
  uploadPhotos,
  search,
  validate,
  generateUniqueId,
};

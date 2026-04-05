require('dotenv').config();
const pool = require('../services/db');

// ── ID generation: yyyymmddnnn ───────────────────────────────────────────────
async function generateUniqueId() {
  const now = new Date();
  const ict = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const yyyy = ict.getFullYear();
  const mm   = String(ict.getMonth() + 1).padStart(2, '0');
  const dd   = String(ict.getDate()).padStart(2, '0');
  const prefix = `${yyyy}${mm}${dd}`;

  const result = await pool.query(
    `SELECT unique_id FROM students 
     WHERE unique_id LIKE $1 
     ORDER BY unique_id DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (result.rows.length > 0) {
    const lastSeq = parseInt(result.rows[0].unique_id.slice(-3), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

// ── Field map: camelCase → snake_case ────────────────────────────────────────
const FIELD_MAP = {
  uniqueId:               'unique_id',
  fullName:               'full_name',
  contactMedium1:         'contact_medium1',
  phoneCountryCode1:      'phone_country_code1',
  contactDetail1:         'contact_detail1',
  contactMedium2:         'contact_medium2',
  phoneCountryCode2:      'phone_country_code2',
  contactDetail2:         'contact_detail2',
  email:                  'email',
  hiddenPhoneCountryCode: 'hidden_phone_country_code',
  phone:                  'phone',
  studyPlans:             'study_plans',
  leadSource:             'lead_source',
  interaction:            'interaction',
  destinationCountry:     'destination_country',
  timeline:               'timeline',
  processApplication:     'process_application',
  residency:              'residency',
  yearOfBirth:            'year_of_birth',
  preferredSocial:        'preferred_social',
  socialConsent:          'social_consent',
  schoolEvent:            'school_event',
  budget:                 'budget',
  scholarshipDemand:      'scholarship_demand',
  englishLevel:           'english_level',
  gpa:                    'gpa',
  immigrationHistory:     'immigration_history',
  sponsorIncome:          'sponsor_income',
  incomeEvidence:         'income_evidence',
  studyPlanGap:           'study_plan_gap',
  ultimateObjective:      'ultimate_objective',
  riskScore:              'risk_score',
  stoneTier:              'stone_tier',
  headshotUrl:            'headshot_url',
  qrCodeImageUrl:         'qr_code_image_url',
  motherEmail:            'mother_email',
  motherFullName:         'mother_full_name',
  motherPhoneCountryCode: 'mother_phone_country_code',
  motherPhone:            'mother_phone',
  motherContactMedium:    'mother_contact_medium',
  motherContactCC:        'mother_contact_cc',
  motherContactDetail:    'mother_contact_detail',
  fatherEmail:            'father_email',
  fatherFullName:         'father_full_name',
  fatherPhoneCountryCode: 'father_phone_country_code',
  fatherPhone:            'father_phone',
  fatherContactMedium:    'father_contact_medium',
  fatherContactCC:        'father_contact_cc',
  fatherContactDetail:    'father_contact_detail',
  counselingNotes:        'counseling_notes',
  caseOfficerNotes:       'case_officer_notes',
  managementNotes:        'management_notes',
  createdAt:              'created_at',
  updatedAt:              'updated_at',
  status:                 'status',
};

// ── Convert DB row → camelCase ───────────────────────────────────────────────
function toCamelCase(row) {
  const result = {};
  for (const [camel, snake] of Object.entries(FIELD_MAP)) {
    result[camel] = row[snake] ?? '';
  }
  return result;
}

// ── create ───────────────────────────────────────────────────────────────────
async function create(data) {
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    throw new Error('Invalid email format');
  }

  const uniqueId = await generateUniqueId();
  const now = new Date();

  await pool.query(
    `INSERT INTO students (
      unique_id, full_name,
      contact_medium1, phone_country_code1, contact_detail1,
      contact_medium2, phone_country_code2, contact_detail2,
      email, hidden_phone_country_code, phone,
      study_plans, lead_source, residency,
      year_of_birth, preferred_social, social_consent, school_event,
      status, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
    )`,
    [
      uniqueId,
      data.fullName          || '',
      data.contactMedium1    || '',
      data.phoneCountryCode1 || '',
      data.contactDetail1    || '',
      data.contactMedium2    || '',
      data.phoneCountryCode2 || '',
      data.contactDetail2    || '',
      data.email             || '',
      data.phoneCountryCode  || '',
      data.phone             || '',
      data.studyPlans        || '',
      data.leadSource        || '',
      data.residency         || '',
      data.yearOfBirth       || '',
      data.preferredSocial   || '',
      data.socialConsent     || '',
      data.schoolEvent       || '',
      'Active',
      now,
      now,
    ]
  );

  const result = await pool.query(
    'SELECT * FROM students WHERE unique_id = $1', [uniqueId]
  );
  return toCamelCase(result.rows[0]);
}

// ── findById ─────────────────────────────────────────────────────────────────
async function findById(uniqueId) {
  const result = await pool.query(
    'SELECT * FROM students WHERE unique_id = $1', [uniqueId]
  );
  if (result.rows.length === 0) return null;
  return { data: toCamelCase(result.rows[0]) };
}

// ── findByEmail ──────────────────────────────────────────────────────────────
async function findByEmail(email) {
  const result = await pool.query(
    'SELECT * FROM students WHERE email = $1', [email]
  );
  if (result.rows.length === 0) return null;
  return { data: toCamelCase(result.rows[0]) };
}

// ── update ───────────────────────────────────────────────────────────────────
async function update(uniqueId, data) {
  const existing = await findById(uniqueId);
  if (!existing) throw new Error('Student not found');

  const fields = [];
  const values = [];
  let i = 1;

  for (const key of Object.keys(data)) {
    // Skip system fields
    if (key === 'uniqueId' || key === 'createdAt' || key === 'updatedAt') continue;
    // Skip fields not in our field map
    const col = FIELD_MAP[key];
    if (!col || col === 'unique_id' || col === 'created_at' || col === 'updated_at') continue;

    let value = data[key];
    if (key === 'destinationCountry' && Array.isArray(value)) {
      value = value.join(', ');
    }

    fields.push(`${col} = $${i}`);
    values.push(value ?? '');
    i++;
  }

  if (fields.length === 0) return existing.data;

  fields.push(`updated_at = $${i}`);
  values.push(new Date());
  i++;
  values.push(uniqueId);

  await pool.query(
    `UPDATE students SET ${fields.join(', ')} WHERE unique_id = $${i}`,
    values
  );

  const result = await pool.query(
    'SELECT * FROM students WHERE unique_id = $1', [uniqueId]
  );
  return toCamelCase(result.rows[0]);
}

// ── checkDuplicates ──────────────────────────────────────────────────────────
async function checkDuplicates(email, phone) {
  const result = await pool.query(
    `SELECT * FROM students 
     WHERE (email = $1 AND email != '') 
        OR (phone = $2 AND phone != '')`,
    [email || '', phone || '']
  );
  return result.rows.map(toCamelCase);
}

// ── deactivateRecords ────────────────────────────────────────────────────────
async function deactivateRecords(uniqueIds) {
  await pool.query(
    `UPDATE students SET status = 'Inactive', updated_at = $1 
     WHERE unique_id = ANY($2)`,
    [new Date(), uniqueIds]
  );
  return { deactivated: uniqueIds };
}

// ── uploadPhotos ─────────────────────────────────────────────────────────────
async function uploadPhotos(uniqueId, photos) {
  const fields = [];
  const values = [];
  let i = 1;

  if (photos.headshot) {
    fields.push(`headshot_url = $${i}`);
    values.push(photos.headshot);
    i++;
  }
  if (photos.qrCodeImage) {
    fields.push(`qr_code_image_url = $${i}`);
    values.push(photos.qrCodeImage);
    i++;
  }

  if (fields.length === 0) return {};

  fields.push(`updated_at = $${i}`);
  values.push(new Date());
  i++;
  values.push(uniqueId);

  await pool.query(
    `UPDATE students SET ${fields.join(', ')} WHERE unique_id = $${i}`,
    values
  );

  const result = await pool.query(
    'SELECT headshot_url, qr_code_image_url FROM students WHERE unique_id = $1',
    [uniqueId]
  );
  if (result.rows.length === 0) throw new Error('Student not found');
  return {
    headshotUrl:    result.rows[0].headshot_url,
    qrCodeImageUrl: result.rows[0].qr_code_image_url,
  };
}

// ── searchStudents ───────────────────────────────────────────────────────────
async function searchStudents(query) {
  const q = `%${query}%`;
  const result = await pool.query(
    `SELECT * FROM students 
     WHERE full_name ILIKE $1 
        OR email     ILIKE $1 
        OR phone     ILIKE $1 
        OR unique_id ILIKE $1
     ORDER BY created_at DESC`,
    [q]
  );
  return result.rows.map(toCamelCase);
}

module.exports = {
  create,
  findById,
  findByEmail,
  update,
  checkDuplicates,
  deactivateRecords,
  uploadPhotos,
  searchStudents,
};
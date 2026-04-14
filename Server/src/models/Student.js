// server/src/models/Student.js
// CHANGES:
//   - buildContactColumns() now includes phoneCountryCode1-5 to match live GAS HEADERS
//   - create() adds hiddenPhoneCountryCode, motherPhone, motherPhoneCountryCode,
//     fatherPhone, fatherPhoneCountryCode to match live GAS HEADERS
//   - status: 'Active' on all new records
//   - create() now includes campaignType, campaignName, campaignStart, campaignEnd

const sheets = require('../services/googleSheets');

const REQUIRED_FIELDS = [];
const MAX_CONTACTS = 2;

function toIndochinaISO() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).replace(' ', 'T') + '+07:00';
}

function generateDatePrefix() {
  const now = new Date();
  const ict = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const y = ict.getFullYear();
  const m = String(ict.getMonth() + 1).padStart(2, '0');
  const d = String(ict.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

async function generateUniqueId() {
  const prefix = generateDatePrefix();
  const seq = await sheets.getNextSequenceNumber(prefix);
  return `${prefix}-${String(seq).padStart(2, '0')}`;
}

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

// Builds contact columns including phoneCountryCode to match live GAS HEADERS:
// contactMedium1, phoneCountryCode1, contactDetail1 ... (x5)
function buildContactColumns(data) {
  const cols = {};
  for (let i = 1; i <= MAX_CONTACTS; i++) {
    cols[`contactMedium${i}`]      = data[`contactMedium${i}`]      || '';
    cols[`phoneCountryCode${i}`]   = data[`phoneCountryCode${i}`]   || '';
    cols[`contactDetail${i}`]      = data[`contactDetail${i}`]      || '';
  }
  return cols;
}

async function create(data) {
  const errors = validate(data);
  if (errors.length) throw new Error(errors.join(', '));

  const uniqueId = await generateUniqueId();
  const now = toIndochinaISO();
  const record = {
    uniqueId,
    fullName:               data.fullName               || '',
    ...buildContactColumns(data),
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
    socialConsent:          data.socialConsent          || data.connectWithYou  || '',
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
    campaignType:           data.campaignType           || '',
    campaignName:           data.campaignName           || '',
    campaignStart:          data.campaignStart          || null,
    campaignEnd:            data.campaignEnd            || null,
    createdAt:              now,
    updatedAt:              now,
    status:                 'Active',
  };

  await sheets.createStudentRow(record);
  return record;
}

async function findByEmail(email) {
  const result = await sheets.getStudentByEmail(email);
  if (!result) return null;
  return { data: result.row, rowIndex: result.rowIndex };
}

async function findById(uniqueId) {
  const result = await sheets.getStudentById(uniqueId);
  if (!result) return null;
  return { data: result.row, rowIndex: result.rowIndex };
}

async function update(uniqueId, data) {
  const existing = await findById(uniqueId);
  if (!existing) throw new Error('Student not found');

  const updated = { ...existing.data };
  for (const [key, value] of Object.entries(data)) {
    if (key === 'uniqueId' || key === 'createdAt') continue;
    if (key === 'destinationCountry' && Array.isArray(value)) {
      updated[key] = value.join(', ');
    } else {
      updated[key] = value ?? updated[key];
    }
  }
  updated.updatedAt = toIndochinaISO();

  await sheets.updateStudentRow(uniqueId, updated);
  return updated;
}

async function checkDuplicates(email, phone) {
  return sheets.searchDuplicates(email, phone);
}

async function deactivateRecords(uniqueIds) {
  return sheets.deactivateRecords(uniqueIds);
}

async function uploadPhotos(uniqueId, photos) {
  return sheets.uploadPhotos(uniqueId, photos);
}

module.exports = {
  create,
  findByEmail,
  findById,
  update,
  checkDuplicates,
  deactivateRecords,
  validate,
  generateUniqueId,
  uploadPhotos,
};

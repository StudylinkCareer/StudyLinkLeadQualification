// ─────────────────────────────────────────────────────────────────────
// auditFilterableData.js
// Standalone script — audits every filterable field in the students table
// against its canonical list (from formFields.js or staff table) and
// produces an Excel file documenting what's clean, what's auto-mappable,
// and what needs your manual review.
//
// Usage (run from the Server/ directory):
//   npm install xlsx              # one-time
//   node scripts/auditFilterableData.js
//
// Outputs:
//   data-audit-YYYY-MM-DD.xlsx in the Server/ directory.
//
// Workflow:
//   1) Run this script. Open the resulting Excel.
//   2) Review the "Audit" sheet. The 'apply_mapping' column is pre-filled
//      for clear matches (e.g. "QUANG NGAI" → "Quảng Ngãi"). For anything
//      blank, decide manually:
//         - Type the canonical value to remap (e.g., "United Kingdom")
//         - Type "DROP" to clear the field (UPDATE col=NULL)
//         - Leave blank to keep the value as-is
//   3) Save the Excel. Run applyDataMappings.js (separate script) to apply.
// ─────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { Pool } = require('pg');
const XLSX     = require('xlsx');
const path     = require('path');
const fs       = require('fs');

// ── Canonical lists (mirrors Client/src/utils/formFields.js) ──────────
// Inlined so this script has zero ES-module / cross-package coupling.
// If you update formFields.js, update these too — or extract them to a
// shared JSON file consumed by both.
const STUDY_PLANS = ['Study Abroad', 'English Summer School', 'Study in Vietnam', 'Do not study'];

const LEAD_SOURCES = [
  'Databases', 'FB-Zalo-GG-TikTok ads', 'School outreach',
  'Subagent referrals', 'Ex-client',
];

const INTERACTIONS = [
  'Only left contact', 'Queries', 'Fill lead form partly',
  'Fill lead form fully', 'Call in-Walk in',
];

const DESTINATION_COUNTRIES = [
  'Australia', 'Canada', 'Germany', 'Japan', 'South Korea',
  'New Zealand', 'Singapore', 'United Kingdom', 'United States',
  'France', 'Netherlands', 'Ireland', 'Switzerland', 'Finland',
  'Denmark', 'Sweden', 'Norway', 'Czech Republic', 'Hungary',
  'Malaysia', 'Thailand', 'Philippines', 'China', 'Taiwan',
];

const TIMELINES = [
  'Next 6 months', '6-12 months', '12-24 months',
  '24-36 months', '36+ months',
];

const VIETNAM_PROVINCES = [
  'An Giang', 'Bà Rịa-Vũng Tàu', 'Bắc Giang', 'Bắc Kạn', 'Bạc Liêu',
  'Bắc Ninh', 'Bến Tre', 'Bình Định', 'Bình Dương', 'Bình Phước',
  'Bình Thuận', 'Cà Mau', 'Cần Thơ', 'Cao Bằng', 'Đà Nẵng',
  'Đắk Lắk', 'Đắk Nông', 'Điện Biên', 'Đồng Nai', 'Đồng Tháp',
  'Gia Lai', 'Hà Giang', 'Hà Nam', 'Hà Nội', 'Hà Tĩnh',
  'Hải Dương', 'Hải Phòng', 'Hậu Giang', 'Hồ Chí Minh', 'Hòa Bình',
  'Hưng Yên', 'Khánh Hòa', 'Kiên Giang', 'Kon Tum', 'Lai Châu',
  'Lâm Đồng', 'Lạng Sơn', 'Lào Cai', 'Long An', 'Nam Định',
  'Nghệ An', 'Ninh Bình', 'Ninh Thuận', 'Phú Thọ', 'Phú Yên',
  'Quảng Bình', 'Quảng Nam', 'Quảng Ngãi', 'Quảng Ninh', 'Quảng Trị',
  'Sóc Trăng', 'Sơn La', 'Tây Ninh', 'Thái Bình', 'Thái Nguyên',
  'Thanh Hóa', 'Thừa Thiên Huế', 'Tiền Giang', 'Trà Vinh', 'Tuyên Quang',
  'Vĩnh Long', 'Vĩnh Phúc', 'Yên Bái',
];

const CONTACT_MEDIUMS = [
  'Phone', 'Zalo', 'Facebook', 'Messenger', 'WhatsApp', 'Email',
  'Instagram', 'Threads', 'TikTok', 'Line', 'Telegram', 'Viber',
  'YouTube', 'Skype',
];

const BUDGETS                  = ['< 300M VND', '300-500M VND', '500-800M VND', '800M-1B VND', '1-1.5B VND'];
const SCHOLARSHIP_DEMANDS      = ['100% scholarship', '60-90% scholarship', '30-50% scholarship', '20-25% scholarship', 'No scholarship needed'];
const ENGLISH_LEVELS           = ['Beginner', 'IELTS 4-4.5', 'IELTS 5-5.5', 'IELTS 6-6.5', 'IELTS 7+'];
const GPAS                     = ['< 6.5', '6.5-6.9', '7-7.9', '8-8.9', '9+'];
const IMMIGRATION_HISTORIES    = ['Visa rejection (self)', 'Rejection/overstay (family)', 'No travel history', 'Travelled in Asia', 'Travelled to Western countries'];
const SPONSOR_INCOMES          = ['< 300M VND', '300-500M VND', '500-800M VND', '800M-1B VND', '1-1.5B VND'];
const INCOME_EVIDENCES         = ['0% documented', '30-35% documented', '50% documented', '70-75% documented', '100% documented'];
const STUDY_PLAN_GAPS          = ['Different major, 5+ year gap', 'Different major, 2-5 year gap', 'Same major, 2-5 year gap', 'Same major, < 2 year gap', 'Same major, no gap'];
const ULTIMATE_OBJECTIVES      = ['Migration only', 'Work only', 'Study but work more', 'Study for migration pathway', 'Study only'];
const LEAD_STATUSES            = ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost', 'On Hold'];
const STONE_TIERS              = ['Diamond', 'Ruby', 'Sapphire', 'Agate', 'Quartz'];
const SOCIAL_CONSENTS          = ['Yes', 'No'];

// ── Field definitions ───────────────────────────────────────────────
// For each filterable field: DB column, JS name, human label,
// and either a canonical array OR a sentinel "STAFF" (resolved at runtime).
// canonical = null means free-text, no validation possible — just list values.
const FIELDS = [
  // Lead management
  { dbCol: 'lead_status',         jsName: 'leadStatus',         label: 'Lead Status',         canonical: LEAD_STATUSES },
  { dbCol: 'stone_tier',          jsName: 'stoneTier',          label: 'Stone Tier',          canonical: STONE_TIERS },
  { dbCol: 'lead_source',         jsName: 'leadSource',         label: 'Lead Source',         canonical: LEAD_SOURCES },
  { dbCol: 'study_plans',         jsName: 'studyPlans',         label: 'Study Plans',         canonical: STUDY_PLANS },
  { dbCol: 'interaction',         jsName: 'interaction',        label: 'Interaction',         canonical: INTERACTIONS },
  { dbCol: 'destination_country', jsName: 'destinationCountry', label: 'Destination Country', canonical: DESTINATION_COUNTRIES },
  { dbCol: 'timeline',            jsName: 'timeline',           label: 'Timeline',            canonical: TIMELINES },
  { dbCol: 'confidence',          jsName: 'confidence',         label: 'Confidence',          canonical: null },
  { dbCol: 'counselor',           jsName: 'counselor',          label: 'Counselor',           canonical: 'STAFF' },
  { dbCol: 'senior_counselor',    jsName: 'seniorCounselor',    label: 'Senior Counselor',    canonical: 'STAFF' },
  { dbCol: 'presales',            jsName: 'presales',           label: 'Pre-sales',           canonical: 'STAFF' },
  { dbCol: 'marketing_staff',     jsName: 'marketingStaff',     label: 'Marketing Staff',     canonical: 'STAFF' },

  // Personal
  { dbCol: 'year_of_birth',       jsName: 'yearOfBirth',        label: 'Year of Birth',       canonical: 'YEAR' },
  { dbCol: 'residency',           jsName: 'residency',          label: 'Residency',           canonical: VIETNAM_PROVINCES },
  { dbCol: 'school_event',        jsName: 'schoolEvent',        label: 'School / Event',      canonical: null },
  { dbCol: 'preferred_social',    jsName: 'preferredSocial',    label: 'Preferred Social',    canonical: CONTACT_MEDIUMS },
  { dbCol: 'social_consent',      jsName: 'socialConsent',      label: 'Connect With Us',     canonical: SOCIAL_CONSENTS },

  // Self-assessment
  { dbCol: 'budget',              jsName: 'budget',             label: 'Budget',              canonical: BUDGETS },
  { dbCol: 'scholarship_demand',  jsName: 'scholarshipDemand',  label: 'Scholarship Demand',  canonical: SCHOLARSHIP_DEMANDS },
  { dbCol: 'english_level',       jsName: 'englishLevel',       label: 'English Level',       canonical: ENGLISH_LEVELS },
  { dbCol: 'gpa',                 jsName: 'gpa',                label: 'GPA',                 canonical: GPAS },
  { dbCol: 'immigration_history', jsName: 'immigrationHistory', label: 'Immigration History', canonical: IMMIGRATION_HISTORIES },
  { dbCol: 'sponsor_income',      jsName: 'sponsorIncome',      label: 'Sponsor Income',      canonical: SPONSOR_INCOMES },
  { dbCol: 'income_evidence',     jsName: 'incomeEvidence',     label: 'Income Evidence',     canonical: INCOME_EVIDENCES },
  { dbCol: 'study_plan_gap',      jsName: 'studyPlanGap',       label: 'Study Plan Gap',      canonical: STUDY_PLAN_GAPS },
  { dbCol: 'ultimate_objective',  jsName: 'ultimateObjective',  label: 'Ultimate Objective',  canonical: ULTIMATE_OBJECTIVES },

  // Family
  { dbCol: 'mother_contact_medium', jsName: 'motherContactMedium', label: 'Mother Contact Medium', canonical: CONTACT_MEDIUMS },
  { dbCol: 'father_contact_medium', jsName: 'fatherContactMedium', label: 'Father Contact Medium', canonical: CONTACT_MEDIUMS },

  // Campaign — free text by design
  { dbCol: 'campaign_type',       jsName: 'campaignType',       label: 'Campaign Type',       canonical: null },
  { dbCol: 'campaign_name',       jsName: 'campaignName',       label: 'Campaign Name',       canonical: null },
];

// ── Normalization for clear-match detection ─────────────────────────
// Strips diacritics, collapses whitespace, lowercases.
// "QUẢNG NGÃI" → "quang ngai"; "Hà Nội" → "ha noi"
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns one of:
//   { status: 'canonical' }                — already a canonical value
//   { status: 'clear-match', target: 'X' } — normalized match to a canonical
//   { status: 'unmapped' }                 — no auto-suggestion possible
//   { status: 'free-text' }                — field has no canonical list
function classifyValue(value, canonical) {
  if (canonical === null) return { status: 'free-text' };
  if (canonical === 'YEAR') {
    const n = parseInt(value, 10);
    return (n >= 1900 && n <= new Date().getFullYear())
      ? { status: 'canonical' }
      : { status: 'unmapped' };
  }
  if (!Array.isArray(canonical) || canonical.length === 0) return { status: 'free-text' };
  if (canonical.includes(value)) return { status: 'canonical' };
  const norm = normalize(value);
  const hit = canonical.find(c => normalize(c) === norm);
  if (hit) return { status: 'clear-match', target: hit };
  return { status: 'unmapped' };
}

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

  // Pre-fetch staff names for staff-referenced fields
  console.log('Loading staff list...');
  const staffRes = await pool.query("SELECT full_name FROM staff WHERE is_active IS NOT FALSE ORDER BY full_name");
  const STAFF_NAMES = staffRes.rows.map(r => r.full_name).filter(Boolean);
  console.log(`  ${STAFF_NAMES.length} active staff loaded.`);

  const auditRows = [];
  const summaryRows = [];

  for (const field of FIELDS) {
    process.stdout.write(`Auditing ${field.jsName.padEnd(24)} ... `);
    const canon = field.canonical === 'STAFF' ? STAFF_NAMES : field.canonical;

    const res = await pool.query(
      `SELECT ${field.dbCol} AS value, COUNT(*)::int AS count
         FROM students
        WHERE ${field.dbCol} IS NOT NULL AND ${field.dbCol} <> ''
        GROUP BY ${field.dbCol}
        ORDER BY count DESC, value ASC`
    );

    let canonicalCount = 0, clearMatchCount = 0, unmappedCount = 0;
    let canonicalRows = 0, clearMatchRows = 0, unmappedRows = 0;

    for (const row of res.rows) {
      const c = classifyValue(row.value, canon);
      let suggested = '';
      let preFilled = '';
      if (c.status === 'clear-match') {
        suggested = `${c.target}`;
        preFilled = c.target;            // pre-fill apply_mapping with the canonical target
        clearMatchCount++;
        clearMatchRows += row.count;
      } else if (c.status === 'canonical') {
        canonicalCount++;
        canonicalRows += row.count;
      } else if (c.status === 'unmapped') {
        unmappedCount++;
        unmappedRows += row.count;
      }

      auditRows.push({
        field:              field.jsName,
        label:              field.label,
        value:              row.value,
        count:              row.count,
        status:             c.status,            // canonical | clear-match | unmapped | free-text
        suggested_mapping:  suggested,
        apply_mapping:      preFilled,           // EDIT THIS in Excel before running apply script
        notes:              '',
      });
    }

    summaryRows.push({
      field:                field.jsName,
      label:                field.label,
      canonical_or_freetext: field.canonical === null ? 'free-text' :
                             field.canonical === 'STAFF' ? `staff (${STAFF_NAMES.length})` :
                             field.canonical === 'YEAR' ? 'year 1900-now' :
                             `${field.canonical.length} values`,
      distinct_values:      res.rows.length,
      total_rows:           res.rows.reduce((s, r) => s + r.count, 0),
      canonical_values:     canonicalCount,
      clear_match_values:   clearMatchCount,
      unmapped_values:      unmappedCount,
      canonical_rows:       canonicalRows,
      clear_match_rows:     clearMatchRows,
      unmapped_rows:        unmappedRows,
    });

    console.log(`${res.rows.length.toString().padStart(4)} distinct, ${clearMatchCount} auto-map, ${unmappedCount} needs review`);
  }

  // ── Write Excel ────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  // Summary sheet first
  const summaryWS = XLSX.utils.json_to_sheet(summaryRows);
  summaryWS['!cols'] = [
    { wch: 22 }, { wch: 24 }, { wch: 20 },
    { wch: 16 }, { wch: 12 },
    { wch: 16 }, { wch: 18 }, { wch: 16 },
    { wch: 14 }, { wch: 16 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, summaryWS, 'Summary');

  // Audit sheet
  const auditWS = XLSX.utils.json_to_sheet(auditRows);
  auditWS['!cols'] = [
    { wch: 22 }, { wch: 24 }, { wch: 40 },
    { wch: 8 },  { wch: 14 }, { wch: 32 }, { wch: 32 }, { wch: 30 },
  ];
  // Freeze the header row
  auditWS['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, auditWS, 'Audit');

  const ts = new Date().toISOString().slice(0, 10);
  const outFile = path.resolve(__dirname, `../data-audit-${ts}.xlsx`);
  XLSX.writeFile(wb, outFile);

  console.log('');
  console.log(`✓ Done. Output: ${outFile}`);
  console.log(`  Summary: ${summaryRows.length} fields`);
  console.log(`  Audit:   ${auditRows.length} rows`);
  console.log('');
  console.log('Next: open the Excel, review the "apply_mapping" column for each row.');
  console.log('Clear matches are pre-filled. For unmapped values, type the canonical value');
  console.log('to remap, "DROP" to clear, or leave blank to keep the value as-is.');

  await pool.end();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});

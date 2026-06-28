// server/src/models/Lead.js
//
// The Lead (engagement) model — one row per engagement, many per student.
//   leads.lead_id   : integer PK (auto-increment)
//   leads.person_id : the owning student (FK -> students.student_id), exposed
//                     to the API as `studentId`
// All other columns are engagement fields (status, counsellor, tier, source,
// dates, per-lead notes pointers, etc.). Identity/family/OCEAN stay on students.
//
// Mirrors the conventions in models/Student.js: explicit snake<->camel column
// map, DATE columns formatted to YYYY-MM-DD, pg Pool used directly.

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── Column map: DB snake_case <-> JS camelCase ───────────────────────────────
// person_id is surfaced as `studentId` (the owning student). lead_id stays read-only.
const COLUMNS = [
  { db: 'lead_id',             js: 'leadId' },
  { db: 'person_id',           js: 'studentId' },
  { db: 'lead_status',         js: 'leadStatus' },
  { db: 'status',              js: 'status' },
  { db: 'counselor',           js: 'counselor' },
  { db: 'senior_counselor',    js: 'seniorCounselor' },
  { db: 'presales',            js: 'presales' },
  { db: 'marketing_staff',     js: 'marketingStaff' },
  { db: 'stone_tier',          js: 'stoneTier' },
  { db: 'risk_score',          js: 'riskScore' },
  { db: 'confidence',          js: 'confidence' },
  { db: 'close_date',          js: 'closeDate' },
  { db: 'study_plans',         js: 'studyPlans' },
  { db: 'lead_source',         js: 'leadSource' },
  { db: 'interaction',         js: 'interaction' },
  { db: 'destination_country', js: 'destinationCountry' },
  { db: 'timeline',            js: 'timeline' },
  { db: 'process_application', js: 'processApplication' },
  { db: 'school_event',        js: 'schoolEvent' },
  { db: 'budget',              js: 'budget' },
  { db: 'scholarship_demand',  js: 'scholarshipDemand' },
  { db: 'english_level',       js: 'englishLevel' },
  { db: 'gpa',                 js: 'gpa' },
  { db: 'immigration_history', js: 'immigrationHistory' },
  { db: 'sponsor_income',      js: 'sponsorIncome' },
  { db: 'income_evidence',     js: 'incomeEvidence' },
  { db: 'study_plan_gap',      js: 'studyPlanGap' },
  { db: 'ultimate_objective',  js: 'ultimateObjective' },
  { db: 'qr_code_image_url',   js: 'qrCodeImageUrl' },
  { db: 'counseling_notes',    js: 'counselingNotes' },
  { db: 'case_officer_notes',  js: 'caseOfficerNotes' },
  { db: 'management_notes',    js: 'managementNotes' },
  { db: 'campaign_type',       js: 'campaignType' },
  { db: 'campaign_name',       js: 'campaignName' },
  { db: 'campaign_start',      js: 'campaignStart' },
  { db: 'campaign_end',        js: 'campaignEnd' },
  { db: 'referral_source',     js: 'referralSource' },
  { db: 'mkt_channel',         js: 'mktChannel' },
  { db: 'mkt_attendance',      js: 'mktAttendance' },
  { db: 'mkt_type',            js: 'mktType' },
  { db: 'mkt_contact_name',    js: 'mktContactName' },
  { db: 'mkt_subagent',        js: 'mktSubagent' },
  { db: 'major',               js: 'major' },
  { db: 'school_attended',     js: 'schoolAttended' },
  { db: 'intake',              js: 'intake' },
  { db: 'degree_level',        js: 'degreeLevel' },
  { db: 'target_institution',  js: 'targetInstitution' },
  { db: 'rationale',           js: 'rationale' },
  { db: 'sl_heard_type',       js: 'slHeardType' },
  { db: 'sl_channel',          js: 'slChannel' },
  { db: 'sl_referral_kind',    js: 'slReferralKind' },
  { db: 'sl_referral_who',     js: 'slReferralWho' },
  { db: 'database_source',     js: 'databaseSource' },
  { db: 'source',              js: 'source' },
  { db: 'source_detail',       js: 'sourceDetail' },
  { db: 'source_unverified',   js: 'sourceUnverified' },
  { db: 'office',              js: 'office' },
  { db: 'distribution_status', js: 'distributionStatus' },
  { db: 'prev_counselor',      js: 'prevCounselor' },
  { db: 'created_at',          js: 'createdAt' },
  { db: 'updated_at',          js: 'updatedAt' },
];

const DB_TO_JS = Object.fromEntries(COLUMNS.map(c => [c.db, c.js]));
const JS_TO_DB = Object.fromEntries(COLUMNS.map(c => [c.js, c.db]));

// DATE columns — pg returns Date objects; convert to YYYY-MM-DD strings.
const DATE_COLUMNS = new Set(['closeDate', 'campaignStart', 'campaignEnd']);
// Never writable through create/update (managed by DB / set on create only).
const READONLY = new Set(['leadId', 'studentId', 'createdAt', 'updatedAt']);

function rowToJs(row) {
  if (!row) return null;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const jsKey = DB_TO_JS[key] || key;
    if (DATE_COLUMNS.has(jsKey) && value) {
      const d = value instanceof Date ? value : new Date(value);
      out[jsKey] = d.toISOString().slice(0, 10);
    } else {
      out[jsKey] = value;
    }
  }
  return out;
}

function toIndochinaISO() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).replace(' ', 'T') + '+07:00';
}

// ── List every lead for one student (newest first) ───────────────────────────
async function findByStudent(studentId) {
  const result = await pool.query(
    `SELECT * FROM leads WHERE person_id = $1 ORDER BY lead_id DESC`, [studentId]
  );
  return result.rows.map(rowToJs);
}

// ── Every lead, with the owning student's name (for the lead-level list) ──────
async function listAll() {
  const result = await pool.query(
    `SELECT l.*, s.full_name AS student_name
       FROM leads l JOIN students s ON s.student_id = l.person_id
      ORDER BY l.lead_id DESC`
  );
  return result.rows.map(rowToJs);
}

// ── One lead by its integer id ───────────────────────────────────────────────
async function findById(leadId) {
  const result = await pool.query(`SELECT * FROM leads WHERE lead_id = $1 LIMIT 1`, [leadId]);
  return result.rows.length ? rowToJs(result.rows[0]) : null;
}

// ── Create a new lead for a student (lead_id auto-assigned) ───────────────────
// Self Assessment is Student-level only, so a new lead carries only what is
// passed in `data` (Intake / Degree / Institution / Rationale etc.).
async function create(studentId, data = {}) {
  const now = toIndochinaISO();
  const cols = ['person_id', 'created_at', 'updated_at'];
  const vals = [studentId, now, now];

  for (const [jsKey, value] of Object.entries(data)) {
    if (READONLY.has(jsKey)) continue;
    const dbCol = JS_TO_DB[jsKey];
    if (!dbCol) continue; // ignore unknown fields
    cols.push(dbCol);
    vals.push(value === '' ? null : value);
  }

  const placeholders = vals.map((_, i) => `$${i + 1}`);
  const result = await pool.query(
    `INSERT INTO leads (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    vals
  );
  return rowToJs(result.rows[0]);
}

// ── Update a lead's engagement fields ────────────────────────────────────────
async function update(leadId, data = {}) {
  const setClauses = [];
  const values = [];
  let i = 1;

  for (const [jsKey, value] of Object.entries(data)) {
    if (READONLY.has(jsKey)) continue;
    const dbCol = JS_TO_DB[jsKey];
    if (!dbCol) continue;
    setClauses.push(`${dbCol} = $${i++}`);
    values.push(value === '' ? null : value);
  }

  if (!setClauses.length) return findById(leadId);

  setClauses.push(`updated_at = $${i++}`);
  values.push(toIndochinaISO());
  values.push(leadId); // WHERE param

  const result = await pool.query(
    `UPDATE leads SET ${setClauses.join(', ')} WHERE lead_id = $${i} RETURNING *`, values
  );
  if (!result.rows.length) throw new Error('Lead not found');
  return rowToJs(result.rows[0]);
}

module.exports = { listAll, findByStudent, findById, create, update, rowToJs, COLUMNS };

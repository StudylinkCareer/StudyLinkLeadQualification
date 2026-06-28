// C:/Users/rhod_/Documents/StudyLinkLeadQualification/Server/src/services/eventQualification.js
// ─────────────────────────────────────────────────────────────────────
// Single source of truth for "is this lead qualified for an advance event QR?"
//
// The required-field list now lives in the `event_qualification_fields` table
// and is editable from the admin UI. This module loads it (cached) and runs
// the check. The special rules (one parent, YOB range, self-assessment) stay
// in code — they don't fit a simple on/off field toggle.
// ─────────────────────────────────────────────────────────────────────

// Fallback list — used ONLY if the config table can't be read (e.g. migration
// not run, DB hiccup). Mirrors the seeded defaults so the gate never silently
// passes everyone if the table is unreachable.
const REQUIRED_FALLBACK = [
  'email', 'phone', 'year_of_birth', 'lead_source', 'residency',
  'study_plans', 'preferred_social', 'social_consent', 'destination_country',
  'timeline', 'process_application', 'budget', 'scholarship_demand',
  'english_level', 'gpa', 'immigration_history', 'sponsor_income',
  'income_evidence', 'study_plan_gap', 'ultimate_objective', 'major',
];

const crypto = require('crypto');
const FAIR_TYPE = 'Exhibition / Fair';

const YOB_MIN = 1980;
const YOB_MAX = 2018;
const REQUIRE_SELF_ASSESSMENT = false; // OCEAN optional; flip to true to enforce

// ── Cached load of the required field_keys from the config table ──────
let _cache = null;            // { fields: string[], at: number }
const CACHE_MS = 60 * 1000;   // short TTL covers multi-instance; busted on save

async function loadRequiredFields(pool) {
  if (_cache && (Date.now() - _cache.at) < CACHE_MS) return _cache.fields;
  try {
    const r = await pool.query(
      `SELECT field_key FROM event_qualification_fields
        WHERE is_required = true ORDER BY sort_order`
    );
    const fields = r.rows.map((x) => x.field_key);
    _cache = { fields, at: Date.now() };
    return fields;
  } catch (err) {
    console.error('[eventQualification] config load failed, using fallback:', err.message);
    return REQUIRED_FALLBACK;
  }
}

// Call after the admin saves new toggles so the next check re-reads the table.
function clearQualificationCache() { _cache = null; }

// ── Helpers ──────────────────────────────────────────────────────────
function present(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}
// parentComplete() was removed: parent details are no longer part of the gate.
function yobValid(s) {
  if (!present(s.year_of_birth)) return false;
  const raw = String(s.year_of_birth).trim();
  if (!/^\d+$/.test(raw)) return false;
  const n = parseInt(raw, 10);
  return n >= YOB_MIN && n <= YOB_MAX;
}
function selfAssessmentComplete(s) {
  for (let i = 1; i <= 15; i++) if (!present(s[`ocean_q${i}`])) return false;
  return true;
}

// ── The pure check ───────────────────────────────────────────────────
// student        — a row from `students` (snake_case columns)
// requiredFields — array of field_keys to enforce (from loadRequiredFields)
// options.registered — pass false to flag a missing lead_events row
// Returns { qualified, missing: [...] }
function isEventQualified(student, requiredFields, options = {}) {
  const missing = [];
  if (!student || typeof student !== 'object') {
    return { qualified: false, missing: ['(no student record)'] };
  }
  const fields = Array.isArray(requiredFields) ? requiredFields : REQUIRED_FALLBACK;

  for (const f of fields) {
    if (!present(student[f])) missing.push(f);
  }
  if (fields.includes('year_of_birth') && present(student.year_of_birth) && !yobValid(student)) {
    missing.push('year_of_birth (out of range)');
  }
  // Parent details are intentionally OPTIONAL — never block qualification.
  // (Admin saves can't persist masked parent contact fields, and the business
  //  rule is that missing parent info should not gate an advance event QR.)
  if (REQUIRE_SELF_ASSESSMENT && !selfAssessmentComplete(student)) {
    missing.push('self_assessment (ocean_q1..q15)');
  }
  if (options.registered === false) {
    missing.push('event_registration');
  }
  return { qualified: missing.length === 0, missing };
}

// Academic/target qualification fields moved to the leads table. Overlay the
// student's representative lead (prefer an open lead) so the gate sees them.
const LEAD_QUAL_FIELDS = ['destination_country', 'major', 'process_application', 'study_plans', 'timeline'];

async function overlayLeadQualFields(pool, student) {
  const sid = student && (student.student_id || student.studentId);
  if (!sid) return student;
  try {
    const r = await pool.query(
      `SELECT destination_country, major, process_application, study_plans, timeline
         FROM leads WHERE person_id = $1
        ORDER BY (lead_status NOT IN ('Contracted','Lost','Archived')) DESC, lead_id DESC
        LIMIT 1`, [sid]);
    if (!r.rows.length) return student;
    const lead = r.rows[0];
    const out = { ...student };
    for (const f of LEAD_QUAL_FIELDS) {
      const lv = lead[f];
      if (lv !== null && lv !== undefined && String(lv).trim() !== '') out[f] = lv;          // lead is source of truth
      else if (out[f] === undefined || out[f] === null)                out[f] = lv;          // post-drop: students lacks the column
    }
    return out;
  } catch (e) {
    return student; // never block qualification on a merge hiccup
  }
}

// Convenience: load the config + run the check in one call.
async function checkStudent(pool, student, options = {}) {
  const fields = await loadRequiredFields(pool);
  const merged = await overlayLeadQualFields(pool, student);
  return isEventQualified(merged, fields, options);
}

// ── Advance token issuance ───────────────────────────────────────────
// Mint advance event QR tokens for a qualified, registered student. For each
// FUTURE Exhibition/Fair the student is registered for (lead_events) that has
// no event_attendees row yet, if they pass the gate, insert a row with a token
// and attended_at = NULL ("QR issued"). Never overwrites an existing row.
// Resilient: never throws. Returns [{ eventId, token }] for delivery (2.3e).
async function issueAdvanceTokens(pool, studentUniqueId) {
  try {
    const uid = String(studentUniqueId || '').trim();
    if (!uid) return [];

    const sres = await pool.query(`SELECT * FROM students WHERE student_id = $1 LIMIT 1`, [uid]);
    if (sres.rowCount === 0) return [];
    const student = sres.rows[0];

    const { qualified } = await checkStudent(pool, student);
    if (!qualified) return [];

    const evs = await pool.query(
      `SELECT DISTINCT le.event_id
         FROM lead_events le
         JOIN events e ON e.id = le.event_id
         LEFT JOIN event_attendees ea
                ON ea.event_id = le.event_id AND ea.student_unique_id = $1
        WHERE le.student_id = $1
          AND le.event_id IS NOT NULL
          AND e.event_type = $2
          AND COALESCE(e.end_date, e.start_date) >= CURRENT_DATE
          AND ea.id IS NULL`,
      [uid, FAIR_TYPE]
    );

    const minted = [];
    for (const row of evs.rows) {
      const token = crypto.randomUUID();
      const ins = await pool.query(
        `INSERT INTO event_attendees (event_id, student_unique_id, registered_at, attendance_token)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (event_id, student_unique_id) DO NOTHING
         RETURNING event_id, attendance_token`,
        [row.event_id, uid, token]
      );
      if (ins.rowCount > 0) {
        minted.push({ eventId: ins.rows[0].event_id, token: ins.rows[0].attendance_token });
      }
    }
    return minted;
  } catch (err) {
    console.error('[eventQualification] issueAdvanceTokens failed:', err.message);
    return [];
  }
}

module.exports = {
  isEventQualified,
  loadRequiredFields,
  clearQualificationCache,
  checkStudent,
  issueAdvanceTokens,
  REQUIRED_FALLBACK,
};
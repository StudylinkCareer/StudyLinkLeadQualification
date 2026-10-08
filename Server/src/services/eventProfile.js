// Server/src/services/eventProfile.js
// ─────────────────────────────────────────────────────────────────────
// Qualification-questionnaire helpers shared by the Event Console (check-in
// form, public /profile page) and the Event Desk (on-site flow: booth staff
// complete a student's gem questions after scanning their QR).
// Moved out of routes/eventConsole.js unchanged apart from taking `pool`.
// ─────────────────────────────────────────────────────────────────────

const { overlayLeadQualFields } = require('./eventQualification');

// Engagement qualification fields collected at check-in belong to the lead, not the
// person; everything else stays on students.
const LEAD_QUAL_FIELDS = new Set(['destination_country', 'major', 'process_application', 'study_plans', 'timeline']);

// Contact identifiers are never shown or editable through the questionnaire.
const PROFILE_EXCLUDE = ['email', 'phone', 'preferred_social'];

// Persist whitelisted qualification answers, routing engagement fields to the
// student's representative lead (prefer an open lead) and person fields to students.
async function persistQualificationFields(db, studentId, incoming, allowed) {
  const sSets = [], sVals = [], lSets = [], lVals = [];
  let si = 1, li = 1;
  for (const [k, v] of Object.entries(incoming)) {
    if (!allowed.has(k)) continue;
    const val = v === '' ? null : v;
    if (LEAD_QUAL_FIELDS.has(k)) { lSets.push(`${k} = $${li++}`); lVals.push(val); }
    else                        { sSets.push(`${k} = $${si++}`); sVals.push(val); }
  }
  if (sSets.length) {
    sVals.push(studentId);
    await db.query(`UPDATE students SET ${sSets.join(', ')}, updated_at = NOW() WHERE student_id = $${sVals.length}`, sVals);
  }
  if (lSets.length) {
    lVals.push(studentId);
    await db.query(
      `UPDATE leads SET ${lSets.join(', ')}, updated_at = NOW()
        WHERE lead_id = (SELECT lead_id FROM leads WHERE person_id = $${lVals.length}
                          ORDER BY (lead_status NOT IN ('Contracted','Lost','Archived')) DESC, lead_id DESC
                          LIMIT 1)`, lVals);
  }
  return sSets.length + lSets.length;
}

// Recalculate the questionnaire evaluation (risk score → stone tier) and
// persist it on the student. Mirrors staffController.calculateRisk: post-split,
// two scored fields live ONLY on the lead (destination_country, timeline), so
// overlay them from the first active lead before scoring. Returns the
// riskResult ({ totalScore, stoneTier, ... }) or null if the student is gone.
async function recalcStone(pool, studentId) {
  const Student = require('../models/Student');
  const { calculateRiskScore } = require('../utils/riskCalculator');
  const result = await Student.findById(studentId);
  if (!result) return null;

  const leadRow = (await pool.query(
    `SELECT destination_country, timeline
       FROM leads WHERE person_id = $1
      ORDER BY (lead_status NOT IN ('Contracted','Lost','Archived')) DESC, lead_id ASC
      LIMIT 1`,
    [studentId]
  )).rows[0] || {};

  const riskInput = { ...result.data };
  if (leadRow.destination_country) riskInput.destinationCountry = leadRow.destination_country;
  if (leadRow.timeline)            riskInput.timeline           = leadRow.timeline;

  const riskResult = calculateRiskScore(riskInput);
  await Student.update(studentId, {
    riskScore: String(riskResult.totalScore),
    stoneTier: riskResult.stoneTier,
  });
  return riskResult;
}

// field_key → lookup_values.category. Most are identity; these two differ.
const FIELD_LOOKUP_CATEGORY = { residency: 'vietnam_province', destination_country: 'country' };
function lookupCategoryFor(k) { return FIELD_LOOKUP_CATEGORY[k] || k; }

// Build the streamlined check-in form descriptor for a student: one entry per
// CURRENTLY-required field, with options pulled from lookup_values (select) or
// type 'text' when no list exists. Reads config live, so it tracks the toggles.
async function buildCheckinFields(pool, student, lang = 'en') {
  // Lead-stored qualification fields must come from the LEAD (their source of
  // truth) — the students-table copies are stale pre-split leftovers. This
  // keeps the profile page and check-in form honest about deleted values.
  student = await overlayLeadQualFields(pool, student);
  const vi = lang === 'vi';
  // Question label: use the Vietnamese column when available (added later), else
  // fall back to the English label. Guarded with to_regclass-free COALESCE on a
  // column that may not exist yet, so this stays safe pre-migration: we only add
  // `label_vi` to the SELECT if the column exists.
  const hasQfVi = vi && (await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name='event_qualification_fields' AND column_name='label_vi' LIMIT 1`)).rowCount > 0;
  const labelExpr = hasQfVi ? `COALESCE(NULLIF(label_vi, ''), label)` : `label`;
  const qf = await pool.query(
    `SELECT field_key, ${labelExpr} AS label FROM event_qualification_fields
      WHERE is_required = true ORDER BY sort_order`
  );
  const out = [];
  for (const f of qf.rows) {
    // Option labels: Vietnamese when asked for (label_vi already exists on
    // lookup_values), falling back to English then the code.
    const optLabel = vi
      ? `COALESCE(NULLIF(label_vi, ''), NULLIF(label_en, ''), code)`
      : `COALESCE(NULLIF(label_en, ''), code)`;
    const lv = await pool.query(
      `SELECT code, ${optLabel} AS label
         FROM lookup_values
        WHERE category = $1 AND is_active = true
        ORDER BY sort_order, label_en`,
      [lookupCategoryFor(f.field_key)]
    );
    const options = lv.rows.map((x) => ({ value: x.code, label: x.label }));
    const value = student[f.field_key] != null ? String(student[f.field_key]) : '';
    // A stored value from outside the pickable lookup list (e.g. the
    // system-stamped lead_source 'Event/Campaign') must still display —
    // a <select> whose value has no matching option renders blank. Surface
    // it as an extra option at the top instead.
    if (value && options.length && !options.some((o) => o.value === value)) {
      options.unshift({ value, label: value });
    }
    out.push({
      fieldKey: f.field_key,
      label: f.label,
      type: options.length ? 'select' : 'text',
      options,
      value,
    });
  }
  return out;
}

module.exports = {
  LEAD_QUAL_FIELDS,
  PROFILE_EXCLUDE,
  persistQualificationFields,
  recalcStone,
  buildCheckinFields,
};

// C:/Users/rhod_/Documents/StudyLinkLeadQualification/Server/src/routes/eventConsole.js
// ─────────────────────────────────────────────────────────────────────
// Event Management console — Phase 1 (roster + check-in).
//
// Reuses existing tables:
//   events       — exhibition/fair events (event_type = 'Exhibition / Fair')
//   lead_events  — registrations (the "Event table" on Lead Detail).
//                  student_id (varchar) holds the student's unique_id.
//   students     — leads (PK unique_id, text)
//   staff        — (PK id, int)
// Layers attendance onto the NEW table:
//   event_attendees (event_id, student_unique_id, attended_at, attendance_token, checked_in_by)
//
// Auth: the LM console logs in via /api/staff/login, which sets
// req.session.staffId. We guard on that (NOT req.session.authenticated,
// which belongs to the separate LQ-client auth). Responses are snake_case;
// the LM api.js camelCases them.
//
// Endpoints (mounted at /api/event-console):
//   GET  /events              — exhibition/fair events for the picker (+ counts)
//   GET  /events/:id          — one event's header detail
//   GET  /events/:id/roster   — registered leads (deduped) + check-in state; ?q= search
//   POST /events/:id/checkin  — mark a registered lead attended + mint QR token
// ─────────────────────────────────────────────────────────────────────

const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const { Pool } = require('pg');
const { clearQualificationCache, checkStudent, overlayLeadQualFields } = require('../services/eventQualification');
const { sendEventQrEmail, sendStoneResultEmail, sendRepLinkEmail } = require('../services/emailService');
const { sendEventBadge, sendEventFollowup, sendStoneResult } = require('../services/zaloService');
const { sendFollowupEmail } = require('../services/resendService');
const zaloDeliveryPoller = require('../services/zaloDeliveryPoller');
const { stoneContent, isStoneTier } = require('../utils/stoneContent');

// Public URL of THIS API (e-mail clients fetch badge/stone images from here).
const publicBase = () => (process.env.PUBLIC_BASE_URL
  || 'https://studylinkleadqualification-production.up.railway.app').replace(/\/+$/, '');

// Engagement qualification fields collected at check-in belong to the lead, not the
// person; everything else stays on students.
const LEAD_QUAL_FIELDS = new Set(['destination_country', 'major', 'process_application', 'study_plans', 'timeline']);

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
async function recalcStone(studentId) {
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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const router = express.Router();

const FAIR_TYPE = 'Exhibition / Fair';

// Staff-session auth — mirrors staff.js. The LM login sets req.session.staffId.
function requireStaffAuth(req, res, next) {
  if (!req.session || !req.session.staffId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
}

// ── GET /events ──────────────────────────────────────────────────────
// Exhibition/Fair events, with registered + attended counts for the picker.
router.get('/events', requireStaffAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT e.id, e.name, e.start_date, e.end_date, e.is_active, e.dedicated_counsellor,
              (SELECT COUNT(DISTINCT le.student_id)
                 FROM lead_events le WHERE le.event_id = e.id)                       AS registered_count,
              (SELECT COUNT(*)
                 FROM event_attendees ea
                WHERE ea.event_id = e.id AND ea.attended_at IS NOT NULL)             AS attended_count
         FROM events e
        WHERE e.event_type = $1
        ORDER BY e.start_date DESC NULLS LAST, e.id DESC`,
      [FAIR_TYPE]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[event-console] list events:', err);
    res.status(500).json({ success: false, error: 'Failed to load events' });
  }
});

// ── GET /events/:id ──────────────────────────────────────────────────
router.get('/events/:id', requireStaffAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });
  try {
    const r = await pool.query(
      `SELECT id, name, event_group, event_type, start_date, end_date,
              is_active, dedicated_counsellor, meta
         FROM events WHERE id = $1`,
      [id]
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'Event not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    console.error('[event-console] get event:', err);
    res.status(500).json({ success: false, error: 'Failed to load event' });
  }
});

// ── GET /events/:id/roster ───────────────────────────────────────────
// Registered leads for the event, deduped to one row per student (earliest
// lead_events row → preserves original status), joined to attendance state.
// Optional ?q= filters name / email / phone.
router.get('/events/:id/roster', requireStaffAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });

  const q = (req.query.q || '').trim();
  const params = [id];
  let search = '';
  if (q) {
    params.push(`%${q}%`);
    search = `AND (s.full_name ILIKE $2 OR s.email ILIKE $2 OR s.phone ILIKE $2)`;
  }

  try {
    const r = await pool.query(
      `SELECT le.student_id              AS student_id,
              s.full_name,
              s.email,
              s.phone,
              s.stone_tier,
              le.status,
              ea.attended_at,
              ea.attendance_token,
              ea.badge_emailed_at,
              ea.badge_emailed_to,
              ea.badge_zalo_sent_at,
              ea.badge_zalo_status,
              ea.badge_zalo_msg_id,
              ea.badge_zalo_error,
              ea.badge_zalo_delivered_at,
              ea.followup_zalo_sent_at,
              ea.followup_zalo_status,
              ea.followup_zalo_error,
              ea.followup_emailed_at,
              ea.followup_emailed_to,
              ea.checked_in_by,
              ci.full_name               AS checked_in_by_name
         FROM (
               SELECT DISTINCT ON (student_id) student_id, status
                 FROM lead_events
                WHERE event_id = $1
                ORDER BY student_id, created_at ASC
              ) le
         JOIN students s              ON s.student_id = le.student_id
         LEFT JOIN event_attendees ea ON ea.event_id = $1 AND ea.student_unique_id = le.student_id
         LEFT JOIN staff ci           ON ci.id = ea.checked_in_by
        WHERE TRUE ${search}
        ORDER BY s.full_name ASC`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[event-console] roster:', err);
    res.status(500).json({ success: false, error: 'Failed to load roster' });
  }
});

// ── POST /events/:id/checkin ─────────────────────────────────────────
// Mark a registered lead attended and mint a QR token. Idempotent: a
// re-check-in keeps the original attended_at and token. Body: { studentId }.
router.post('/events/:id/checkin', requireStaffAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });

  const studentId = (req.body.studentId || req.body.unique_id || '').trim();
  if (!studentId) return res.status(400).json({ success: false, error: 'studentId is required' });

  try {
    // Must be on this event's roster (registered in lead_events).
    const reg = await pool.query(
      `SELECT 1 FROM lead_events WHERE event_id = $1 AND student_id = $2 LIMIT 1`,
      [id, studentId]
    );
    if (reg.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Student is not registered for this event' });
    }

    // Optional: persist field values submitted from the check-in form. Keys are
    // whitelisted against the qualification catalog so only known student
    // columns can be written; values are parameterised.
    const incoming = (req.body.fields && typeof req.body.fields === 'object') ? req.body.fields : null;
    if (incoming) {
      const cat = await pool.query(`SELECT field_key FROM event_qualification_fields`);
      const allowed = new Set(cat.rows.map((r) => r.field_key));
      await persistQualificationFields(pool, studentId, incoming, allowed);
    }

    // HARD GATE: cannot complete check-in while any required field is missing.
    const sres = await pool.query(`SELECT * FROM students WHERE student_id = $1 LIMIT 1`, [studentId]);
    const gate = await checkStudent(pool, sres.rows[0] || {});
    if (!gate.qualified) {
      return res.status(422).json({ success: false, error: 'Required fields incomplete', missing: gate.missing });
    }

    // The checking-in staff member is the logged-in user.
    const checkedInBy = req.session.staffId;

    const token = crypto.randomUUID();
    const up = await pool.query(
      `INSERT INTO event_attendees
              (event_id, student_unique_id, registered_at, attended_at, checked_in_by, attendance_token)
            VALUES ($1, $2, NOW(), NOW(), $3, $4)
       ON CONFLICT (event_id, student_unique_id) DO UPDATE
            SET attended_at      = COALESCE(event_attendees.attended_at, EXCLUDED.attended_at),
                checked_in_by    = EXCLUDED.checked_in_by,
                attendance_token = COALESCE(event_attendees.attendance_token, EXCLUDED.attendance_token),
                updated_at       = NOW()
       RETURNING *`,
      [id, studentId, checkedInBy, token]
    );
    res.json({ success: true, data: up.rows[0] });
  } catch (err) {
    console.error('[event-console] checkin:', err);
    res.status(500).json({ success: false, error: 'Failed to check in student' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// DESK SETUP (Phase 2) — institutions master list + per-event desks.
// Reads: any signed-in staff. Writes: Admin/Manager/Director.
// ─────────────────────────────────────────────────────────────────────

const { isManagerOrAdmin, isAdminProfile, canViewEventReports, canViewEventAnalytics } = require('../utils/authProfiles');
function requireDeskAdmin(req, res, next) {
  if (!req.session || !req.session.staffId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (!isManagerOrAdmin(req.session.staffRole)) {
    return res.status(403).json({ success: false, error: 'Insufficient role' });
  }
  next();
}
// Event reports access (Event Console -> Reports tab, file/AI-generated
// reports): Executives, Managers/Leads, Data Quality (see authProfiles).
function requireEventReports(req, res, next) {
  if (!req.session || !req.session.staffId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (!canViewEventReports(req.session.staffRole)) {
    return res.status(403).json({ success: false, error: 'Not authorised for event reports' });
  }
  next();
}
// Event Report ANALYTICS dashboard (Report -> Event Report): narrower than
// requireEventReports above — Executives + Managers only, per explicit
// request to exclude Lead-level profiles and Data Quality from this page.
function requireEventAnalytics(req, res, next) {
  if (!req.session || !req.session.staffId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (!canViewEventAnalytics(req.session.staffRole)) {
    return res.status(403).json({ success: false, error: 'Not authorised for event report analytics' });
  }
  next();
}
// Budget approval ("Duyệt"): the first per-INDIVIDUAL-account gate in this
// app, not per-role — checks req.session.staffEmail against the single
// BUDGET_APPROVER_EMAIL account, not a position/role string. Always stacked
// AFTER requireEventAnalytics (still needs page-level access first).
function requireBudgetApprover(req, res, next) {
  if (!req.session || !req.session.staffId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (!eventBudgetApproval.isApprover(req.session.staffEmail)) {
    return res.status(403).json({ success: false, error: 'Not authorised to approve budgets' });
  }
  next();
}

const MAX_DESKS_PER_EVENT = 50;
function genDeskPin() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

// ── GET /institutions ── master list (active), for the desk picker.
router.get('/institutions', requireStaffAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, country, is_active
         FROM institutions WHERE is_active = true ORDER BY name ASC`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[event-console] list institutions:', err);
    res.status(500).json({ success: false, error: 'Failed to load institutions' });
  }
});

// ── POST /institutions ── add to the master list. Body: { name, country? }.
router.post('/institutions', requireDeskAdmin, async (req, res) => {
  const name    = (req.body.name || '').trim();
  const country = (req.body.country || '').trim() || null;
  if (!name) return res.status(400).json({ success: false, error: 'name is required' });
  try {
    const existing = await pool.query(
      `SELECT id, name, country, is_active FROM institutions WHERE LOWER(name) = LOWER($1)`,
      [name]
    );
    if (existing.rowCount > 0) {
      return res.json({ success: true, data: existing.rows[0], existed: true });
    }
    const ins = await pool.query(
      `INSERT INTO institutions (name, country) VALUES ($1, $2)
       RETURNING id, name, country, is_active`,
      [name, country]
    );
    res.json({ success: true, data: ins.rows[0] });
  } catch (err) {
    console.error('[event-console] create institution:', err);
    res.status(500).json({ success: false, error: 'Failed to create institution' });
  }
});

// ── GET /events/:id/institutions ── desks configured for this event.
router.get('/events/:id/institutions', requireStaffAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });
  try {
    const r = await pool.query(
      `SELECT ei.id, ei.event_id, ei.institution_id, i.name AS institution_name,
              i.country, ei.desk_token, ei.desk_pin, ei.sort_order, ei.is_active,
              (SELECT COUNT(*) FROM event_desk_visits v
                WHERE v.event_id = ei.event_id AND v.institution_id = ei.institution_id) AS visit_count
         FROM event_institutions ei
         JOIN institutions i ON i.id = ei.institution_id
        WHERE ei.event_id = $1 AND ei.is_active = true
        ORDER BY ei.sort_order ASC, i.name ASC`,
      [id]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[event-console] list event desks:', err);
    res.status(500).json({ success: false, error: 'Failed to load event desks' });
  }
});

// ── POST /events/:id/institutions ── add a desk to this event.
// Body: { institutionId } OR { name, country? }. Mints desk_token + desk_pin.
router.post('/events/:id/institutions', requireDeskAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });

  let institutionId = req.body.institutionId ? parseInt(req.body.institutionId, 10) : null;
  const name    = (req.body.name || '').trim();
  const country = (req.body.country || '').trim() || null;

  try {
    const cnt = await pool.query(
      `SELECT COUNT(*)::int AS n FROM event_institutions WHERE event_id = $1 AND is_active = true`,
      [id]
    );
    if (cnt.rows[0].n >= MAX_DESKS_PER_EVENT) {
      return res.status(400).json({ success: false, error: `Maximum ${MAX_DESKS_PER_EVENT} desks per event` });
    }

    if (!institutionId) {
      if (!name) return res.status(400).json({ success: false, error: 'institutionId or name is required' });
      const found = await pool.query(`SELECT id FROM institutions WHERE LOWER(name) = LOWER($1)`, [name]);
      if (found.rowCount > 0) {
        institutionId = found.rows[0].id;
      } else {
        const ins = await pool.query(
          `INSERT INTO institutions (name, country) VALUES ($1, $2) RETURNING id`,
          [name, country]
        );
        institutionId = ins.rows[0].id;
      }
    } else {
      const chk = await pool.query(`SELECT 1 FROM institutions WHERE id = $1`, [institutionId]);
      if (chk.rowCount === 0) return res.status(404).json({ success: false, error: 'Institution not found' });
    }

    const deskToken = crypto.randomUUID();
    const deskPin   = genDeskPin();

    const up = await pool.query(
      `INSERT INTO event_institutions (event_id, institution_id, desk_token, desk_pin)
            VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id, institution_id) DO UPDATE SET is_active = true
       RETURNING id, event_id, institution_id, desk_token, desk_pin, sort_order, is_active`,
      [id, institutionId, deskToken, deskPin]
    );

    const inst = await pool.query(`SELECT name, country FROM institutions WHERE id = $1`, [institutionId]);
    const row = { ...up.rows[0], institution_name: inst.rows[0]?.name, country: inst.rows[0]?.country };
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[event-console] add event desk:', err);
    res.status(500).json({ success: false, error: 'Failed to add desk' });
  }
});

// ── POST /events/:id/institutions/:eiId/regen-pin ── issue a new desk PIN.
router.post('/events/:id/institutions/:eiId/regen-pin', requireDeskAdmin, async (req, res) => {
  const eiId = parseInt(req.params.eiId, 10);
  if (isNaN(eiId)) return res.status(400).json({ success: false, error: 'Invalid desk id' });
  try {
    const r = await pool.query(
      `UPDATE event_institutions SET desk_pin = $1 WHERE id = $2 RETURNING id, desk_pin`,
      [genDeskPin(), eiId]
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'Desk not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    console.error('[event-console] regen desk pin:', err);
    res.status(500).json({ success: false, error: 'Failed to regenerate PIN' });
  }
});

// ── DELETE /events/:id/institutions/:eiId ── remove a desk (soft delete).
router.delete('/events/:id/institutions/:eiId', requireDeskAdmin, async (req, res) => {
  const eiId = parseInt(req.params.eiId, 10);
  if (isNaN(eiId)) return res.status(400).json({ success: false, error: 'Invalid desk id' });
  try {
    const r = await pool.query(
      `UPDATE event_institutions SET is_active = false WHERE id = $1 RETURNING id`,
      [eiId]
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'Desk not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[event-console] remove event desk:', err);
    res.status(500).json({ success: false, error: 'Failed to remove desk' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// REPS (Phase 2.2a) — Event-staff who scan students at desks.
// Reps are real staff rows: staff_type='event', role='Event staff',
// event_id, institution_id (NULL = roving), valid_from/valid_until window,
// plus a personal event_login_token + event_pin. Writes: Admin/Manager/Director.
// ─────────────────────────────────────────────────────────────────────

const POSITION_BY_KIND = { institution: 'Institution rep', studylink: 'StudyLink event staff' };
const { eventLogonId, EVENT_DEFAULT_PASSWORD } = require('../utils/eventRep');

// A rep is now an event_reps LINK row joined to the real staff person.
// `repId` = event_reps.id. Shape kept identical to the old staff-row response
// (source_staff_id = the linked staff id, always set now).
async function repRow(repId) {
  const r = await pool.query(
    `SELECT er.id, s.full_name, er.position, er.institution_id, i.name AS institution_name,
            er.event_login_token, er.event_pin, er.valid_from, er.valid_until, er.is_active,
            er.staff_id AS source_staff_id
       FROM event_reps er
       JOIN staff s ON s.id = er.staff_id
       LEFT JOIN institutions i ON i.id = er.institution_id
      WHERE er.id = $1`,
    [repId]
  );
  return r.rows[0] || null;
}

// ── GET /staff-pool ── real staff selectable as event reps. Excludes the
// synthetic event-staff rows (staff_type='event'); feeds the rep picker.
router.get('/staff-pool', requireStaffAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, full_name, email, role, position, contact_mobile, zalo_number
         FROM staff
        WHERE staff_type <> 'event' AND is_active = true
        ORDER BY full_name ASC`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[event-console] staff-pool:', err);
    res.status(500).json({ success: false, error: 'Failed to load staff' });
  }
});

// ── GET /events/:id/reps ── list this event's reps.
router.get('/events/:id/reps', requireStaffAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });
  try {
    const r = await pool.query(
      `SELECT er.id, s.full_name, er.position, er.institution_id, i.name AS institution_name,
              er.event_login_token, er.event_pin, er.valid_from, er.valid_until, er.is_active,
              er.staff_id AS source_staff_id
         FROM event_reps er
         JOIN staff s ON s.id = er.staff_id
         LEFT JOIN institutions i ON i.id = er.institution_id
        WHERE er.event_id = $1
        ORDER BY er.is_active DESC, s.full_name ASC`,
      [id]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[event-console] list reps:', err);
    res.status(500).json({ success: false, error: 'Failed to load reps' });
  }
});

// ── POST /events/:id/reps ── create a rep (mints login token + PIN).
// Body: { staffId (preferred — picks a real staff member) | fullName (legacy),
//         kind: 'institution'|'studylink', institutionId, validFrom, validUntil }.
router.post('/events/:id/reps', requireDeskAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });

  const staffId       = req.body.staffId ? parseInt(req.body.staffId, 10) : null;
  let   fullName      = (req.body.fullName || '').trim();
  const kind          = req.body.kind === 'studylink' ? 'studylink' : 'institution';
  const institutionId = req.body.institutionId ? parseInt(req.body.institutionId, 10) : null;
  const validFrom     = (req.body.validFrom  || '').trim() || null;
  const validUntil    = (req.body.validUntil || '').trim() || null;

  if (kind === 'institution' && !institutionId) {
    return res.status(400).json({ success: false, error: 'Pick an institution, or choose "To be assigned"' });
  }

  if (institutionId) {
    const chk = await pool.query(`SELECT 1 FROM institutions WHERE id = $1`, [institutionId]);
    if (chk.rowCount === 0) return res.status(404).json({ success: false, error: 'Institution not found' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Resolve the staff row to LINK: existing member → their id (no new row);
    // new recruit → create ONE real event-only staff account.
    let repStaffId = staffId;
    let newAccount = null;                       // {logonId, password} to hand back for a fresh recruit
    if (staffId) {
      const s = await client.query(`SELECT id FROM staff WHERE id = $1 AND is_active = true`, [staffId]);
      if (s.rowCount === 0) { await client.query('ROLLBACK'); client.release(); return res.status(404).json({ success: false, error: 'Staff member not found' }); }
    } else {
      if (!fullName) { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ success: false, error: 'Pick a staff member or enter a name' }); }
      let logonId = eventLogonId(fullName);
      const [local, domain] = logonId.split('@');
      let n = 1;
      while ((await client.query(`SELECT 1 FROM staff WHERE LOWER(email) = LOWER($1)`, [logonId])).rowCount) {
        n += 1; logonId = `${local}-${n}@${domain}`;
      }
      const pwdHash = crypto.createHash('sha256').update(EVENT_DEFAULT_PASSWORD).digest('hex');
      const ins = await client.query(
        `INSERT INTO staff (full_name, email, position, role, password_hash, is_active, created_at)
         VALUES ($1, $2, $3, 'Event staff', $4, true, NOW()) RETURNING id`,
        [fullName, logonId, POSITION_BY_KIND[kind], pwdHash]);
      repStaffId = ins.rows[0].id;
      newAccount = { logonId, password: EVENT_DEFAULT_PASSWORD };
    }

    // Dedup: reuse an existing active link for this (event, staff).
    const dup = await client.query(
      `SELECT id FROM event_reps WHERE event_id = $1 AND staff_id = $2 AND is_active = true LIMIT 1`,
      [id, repStaffId]);
    let repLinkId;
    if (dup.rowCount) {
      repLinkId = dup.rows[0].id;
    } else {
      const link = await client.query(
        `INSERT INTO event_reps
           (event_id, staff_id, position, institution_id, valid_from, valid_until, event_login_token, event_pin, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW()) RETURNING id`,
        [id, repStaffId, POSITION_BY_KIND[kind], institutionId, validFrom, validUntil, crypto.randomUUID(), genDeskPin()]);
      repLinkId = link.rows[0].id;
    }

    await client.query('COMMIT');
    client.release();
    res.json({ success: true, data: await repRow(repLinkId), account: newAccount });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    client.release();
    console.error('[event-console] add rep:', err);
    res.status(500).json({ success: false, error: 'Failed to add rep' });
  }
});

// ── PATCH /events/:id/reps/:repId ── update institution / validity window.
router.patch('/events/:id/reps/:repId', requireDeskAdmin, async (req, res) => {
  const repId = parseInt(req.params.repId, 10);
  if (isNaN(repId)) return res.status(400).json({ success: false, error: 'Invalid rep id' });

  const sets = [], vals = [];
  if (req.body.institutionId !== undefined) { vals.push(req.body.institutionId ? parseInt(req.body.institutionId, 10) : null); sets.push(`institution_id = $${vals.length}`); }
  if (req.body.validFrom     !== undefined) { vals.push((String(req.body.validFrom).trim())  || null); sets.push(`valid_from = $${vals.length}`); }
  if (req.body.validUntil    !== undefined) { vals.push((String(req.body.validUntil).trim()) || null); sets.push(`valid_until = $${vals.length}`); }
  if (sets.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });
  vals.push(repId);

  try {
    const r = await pool.query(
      `UPDATE event_reps SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id`,
      vals
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'Rep not found' });
    res.json({ success: true, data: await repRow(repId) });
  } catch (err) {
    console.error('[event-console] update rep:', err);
    res.status(500).json({ success: false, error: 'Failed to update rep' });
  }
});

// ── POST /events/:id/reps/:repId/regen-pin ── new PIN.
router.post('/events/:id/reps/:repId/regen-pin', requireDeskAdmin, async (req, res) => {
  const repId = parseInt(req.params.repId, 10);
  if (isNaN(repId)) return res.status(400).json({ success: false, error: 'Invalid rep id' });
  try {
    const r = await pool.query(
      `UPDATE event_reps SET event_pin = $1 WHERE id = $2 RETURNING id, event_pin`,
      [genDeskPin(), repId]
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'Rep not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    console.error('[event-console] regen rep pin:', err);
    res.status(500).json({ success: false, error: 'Failed to regenerate PIN' });
  }
});

// ── DELETE /events/:id/reps/:repId ── deactivate (kills sign-in; keeps author_id on past notes).
router.delete('/events/:id/reps/:repId', requireDeskAdmin, async (req, res) => {
  const repId = parseInt(req.params.repId, 10);
  if (isNaN(repId)) return res.status(400).json({ success: false, error: 'Invalid rep id' });
  try {
    const r = await pool.query(
      `UPDATE event_reps SET is_active = false WHERE id = $1 RETURNING id`,
      [repId]
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'Rep not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[event-console] remove rep:', err);
    res.status(500).json({ success: false, error: 'Failed to remove rep' });
  }
});

// ── POST /events/:id/reps/:repId/email-link ── email a rep their one-click
// desk sign-in link. The link carries token + PIN (built server-side, so the
// PIN never travels from the client). Requires source_staff_id so we have a
// real inbox to send to. Body: { baseUrl } (the LQ app base, e.g. VITE_LQ_BASE_URL).
router.post('/events/:id/reps/:repId/email-link', requireDeskAdmin, async (req, res) => {
  const id    = parseInt(req.params.id, 10);
  const repId = parseInt(req.params.repId, 10);
  if (isNaN(id) || isNaN(repId)) return res.status(400).json({ success: false, error: 'Invalid id' });

  const baseUrl = (req.body.baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) {
    return res.status(400).json({ success: false, error: 'Missing or invalid base URL' });
  }

  try {
    const r = await pool.query(
      `SELECT er.id, s.full_name, er.event_login_token, er.event_pin, er.is_active, s.email
         FROM event_reps er JOIN staff s ON s.id = er.staff_id
        WHERE er.id = $1 AND er.event_id = $2 LIMIT 1`,
      [repId, id]
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'Rep not found' });
    const rep = r.rows[0];
    if (!rep.is_active) return res.status(400).json({ success: false, error: 'Rep is deactivated' });
    const email = rep.email;
    if (!email) return res.status(400).json({ success: false, error: 'Linked staff member has no email on file' });

    const ev = await pool.query(`SELECT name FROM events WHERE id = $1`, [id]);
    const eventName = ev.rows[0] ? ev.rows[0].name : '';

    const link = `${baseUrl}/desk?rep=${encodeURIComponent(rep.event_login_token)}&pin=${encodeURIComponent(rep.event_pin)}`;

    await sendRepLinkEmail(email, { name: rep.full_name, eventName, link });
    res.json({ success: true, data: { email } });
  } catch (err) {
    console.error('[event-console] email rep link:', err);
    res.status(500).json({ success: false, error: 'Failed to send sign-in link' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// EVENT-QUALIFICATION CONFIG (Admin only) — which student fields gate an
// advance event QR. Reads/writes event_qualification_fields; the gate
// (eventQualification.js) reads the same table, cached.
// ─────────────────────────────────────────────────────────────────────
function requireAdminOnly(req, res, next) {
  if (!req.session || !req.session.staffId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (!isAdminProfile(req.session.staffRole)) {
    return res.status(403).json({ success: false, error: 'Admin only' });
  }
  next();
}

async function listQualificationFields() {
  const r = await pool.query(
    `SELECT field_key, label, category, is_required, sort_order
       FROM event_qualification_fields ORDER BY sort_order`
  );
  return r.rows;
}

// field_key → lookup_values.category. Most are identity; these two differ.
const FIELD_LOOKUP_CATEGORY = { residency: 'vietnam_province', destination_country: 'country' };
function lookupCategoryFor(k) { return FIELD_LOOKUP_CATEGORY[k] || k; }

// Build the streamlined check-in form descriptor for a student: one entry per
// CURRENTLY-required field, with options pulled from lookup_values (select) or
// type 'text' when no list exists. Reads config live, so it tracks the toggles.
async function buildCheckinFields(student, lang = 'en') {
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

// ── GET /events/:id/desk-sessions ── assignment audit log for the Reps tab:
// every kiosk desk sign-in/switch (rep name, institution, in/out times),
// newest first.
router.get('/events/:id/desk-sessions', requireStaffAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });
  try {
    const r = await pool.query(
      `SELECT ds.id, s.full_name, i.name AS institution_name, ds.started_at, ds.ended_at
         FROM desk_sessions ds
         JOIN staff s ON s.id = ds.staff_id
         LEFT JOIN institutions i ON i.id = ds.institution_id
        WHERE ds.event_id = $1
        ORDER BY ds.started_at DESC
        LIMIT 300`,
      [id]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[event-console] desk-sessions:', err);
    res.status(500).json({ success: false, error: 'Failed to load the assignment log' });
  }
});

// GET /qualification-fields — the full catalog (for the admin grid)
router.get('/qualification-fields', requireAdminOnly, async (req, res) => {
  try {
    res.json({ success: true, data: await listQualificationFields() });
  } catch (err) {
    console.error('[event-console] qualification list:', err);
    res.status(500).json({ success: false, error: 'Failed to load qualification fields' });
  }
});

// PUT /qualification-fields — save toggles. Body: { fields: [{ fieldKey, isRequired }] }
router.put('/qualification-fields', requireAdminOnly, async (req, res) => {
  const incoming = Array.isArray(req.body.fields) ? req.body.fields : [];
  if (incoming.length === 0) {
    return res.status(400).json({ success: false, error: 'No fields provided' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const f of incoming) {
      const key = String(f.fieldKey || f.field_key || '').trim();
      if (!key) continue;
      const required = f.isRequired != null ? f.isRequired : f.is_required;
      await client.query(
        `UPDATE event_qualification_fields
            SET is_required = $1, updated_at = NOW()
          WHERE field_key = $2`,
        [!!required, key]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[event-console] qualification save:', err);
    return res.status(500).json({ success: false, error: 'Failed to save' });
  } finally {
    client.release();
  }
  clearQualificationCache();
  try {
    res.json({ success: true, data: await listQualificationFields() });
  } catch {
    res.json({ success: true });
  }
});

// GET /qualification-check/:studentId — dry-run the gate against a real student.
// Read-only diagnostic: returns { qualified, missing } using the current config.
router.get('/qualification-check/:studentId', requireStaffAuth, async (req, res) => {
  const uid = String(req.params.studentId || '').trim();
  if (!uid) return res.status(400).json({ success: false, error: 'studentId required' });
  try {
    const r = await pool.query(`SELECT * FROM students WHERE student_id = $1 LIMIT 1`, [uid]);
    if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'Student not found' });
    const result = await checkStudent(pool, r.rows[0]);
    res.json({ success: true, data: { studentId: uid, ...result } });
  } catch (err) {
    console.error('[event-console] qualification-check:', err);
    res.status(500).json({ success: false, error: 'Check failed' });
  }
}); 

// GET /events/:id/checkin-fields/:studentId — the streamlined check-in form's
// data: every currently-required field with its label, input type, options
// (from lookup_values) and the student's current value, plus what's missing.
router.get('/events/:id/checkin-fields/:studentId', requireStaffAuth, async (req, res) => {
  const uid = String(req.params.studentId || '').trim();
  if (!uid) return res.status(400).json({ success: false, error: 'studentId required' });
  try {
    const sres = await pool.query(`SELECT * FROM students WHERE student_id = $1 LIMIT 1`, [uid]);
    if (sres.rowCount === 0) return res.status(404).json({ success: false, error: 'Student not found' });
    const student = sres.rows[0];
    const fields = await buildCheckinFields(student);
    const { qualified, missing } = await checkStudent(pool, student);
    res.json({ success: true, data: { fields, missing, qualified } });
  } catch (err) {
    console.error('[event-console] checkin-fields:', err);
    res.status(500).json({ success: false, error: 'Failed to load check-in fields' });
  }
});

// ── PUBLIC "Know you better" student self-service ────────────────────
// Resolved by the badge's attendance_token (unguessable) — no login. Lets a
// registered student answer the qualification questions before the event so
// booths don't re-ask. Qualification fields only; contact details are never
// editable here.
const PROFILE_EXCLUDE = ['email', 'phone', 'preferred_social'];

// GET /profile/:token — questions + the student's current answers.
router.get('/profile/:token', async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ success: false, error: 'Missing link code' });
  try {
    const r = await pool.query(
      `SELECT s.*, e.name AS event_name, e.meta AS event_meta
         FROM event_attendees ea
         JOIN students s ON s.student_id = ea.student_unique_id
         LEFT JOIN events e ON e.id = ea.event_id
        WHERE ea.attendance_token = $1 LIMIT 1`,
      [token]
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'Link not recognised' });
    const student = r.rows[0];
    const all = await buildCheckinFields(student, 'vi');   // student-facing page is Vietnamese
    const fields = all.filter((f) => !PROFILE_EXCLUDE.includes(f.fieldKey));
    // stoneTier lets the page centre the badge QR on the student's stone;
    // stone carries the Vietnamese banner (label + message) shown under it.
    const stone = stoneContent(student.stone_tier, 'vi');
    // Meeting-invite details (time/venue/info link) authored per event via
    // events.meta.invite — see migrations/setEventInvite.js. Null-safe: the
    // page simply omits the card when an event has no invite configured.
    const meta = student.event_meta || {};
    res.json({ success: true, data: {
      fullName: student.full_name,
      fields,
      stoneTier: stone ? stone.tier : '',
      stone,
      eventName: student.event_name || '',
      invite: (meta.invite && typeof meta.invite === 'object') ? meta.invite : null,
    } });
  } catch (err) {
    console.error('[event-console] profile get:', err);
    res.status(500).json({ success: false, error: 'Failed to load your questions' });
  }
});

// Deliver the questionnaire evaluation to the student via e-mail AND Zalo,
// then stamp the attendee row (result_* columns) so the console can see what
// went out. The e-mail carries the UPDATED badge (stone-centred QR, uploaded
// by the page after submit) + the stone banner. Runs fire-and-forget — every
// failure is logged + stamped, never surfaced to the student.
async function sendEvaluationMessages({ token, stone, origin, badgePng = '' }) {
  const r = await pool.query(
    `SELECT ea.event_id, ea.student_unique_id, s.full_name, s.email, s.phone,
            e.name AS event_name, e.meta AS event_meta
       FROM event_attendees ea
       JOIN students s  ON s.student_id = ea.student_unique_id
       LEFT JOIN events e ON e.id = ea.event_id
      WHERE ea.attendance_token = $1 LIMIT 1`,
    [token]
  );
  if (r.rowCount === 0) return;
  const { event_id: eventId, student_unique_id: studentId, full_name: name, event_name: eventName } = r.rows[0];
  const email = String(r.rows[0].email || '').trim();
  const phone = String(r.rows[0].phone || '').trim();
  // Exhibition logistics, authored per event via setEventInvite.js.
  const meta = r.rows[0].event_meta || {};
  const invite = (meta.invite && typeof meta.invite === 'object') ? meta.invite : null;

  // The evaluation lands on the profile page too — link back to it. The submit
  // came from that very page, so its Origin header IS the LQ base URL.
  const lqBase = String(origin || '').trim().replace(/\/+$/, '');
  const profileUrl = /^https?:\/\//i.test(lqBase)
    ? `${lqBase}/profile?t=${encodeURIComponent(token)}`
    : '';

  // On PROD the updated badge is served from the public badge-image route
  // (stored just before this runs) — referenced by URL, never attached, so
  // mail clients can't render a duplicate thumbnail. On dev that URL wouldn't
  // resolve (PROD host, dev token), so we attach the PNG inline instead.
  const isProd = process.env.NODE_ENV === 'production';
  const badgeImageUrl = (badgePng && isProd)
    ? `${publicBase()}/api/event-console/badge-image/${encodeURIComponent(token)}?v=${Date.now()}`
    : '';

  // E-mail leg.
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    try {
      await sendStoneResultEmail(email, {
        name, eventName, stone, profileUrl, badgeImageUrl, invite,
        badgePngBase64: isProd ? '' : badgePng,
      });
      await pool.query(
        `UPDATE event_attendees
            SET result_emailed_at = NOW(), result_emailed_to = $3, updated_at = NOW()
          WHERE event_id = $1 AND student_unique_id = $2`,
        [eventId, studentId, email]
      );
    } catch (e) {
      console.error('[event-console] stone-result email:', e.message);
    }
  }

  // Zalo leg (dormant until ZALO_ZNS_RESULT_TEMPLATE_ID is configured).
  try {
    const zres = await sendStoneResult({
      phone,
      name,
      eventName,
      stoneLabel: stone.label,
      stoneMessage: stone.message,
      profileUrl,
      registrationCode: studentId,
      token,
      invite,
    });
    if (zres.sent) {
      const msgId = (zres.raw && zres.raw.data && (zres.raw.data.msg_id || zres.raw.data.message_id)) || null;
      await pool.query(
        `UPDATE event_attendees
            SET result_zalo_sent_at = NOW(), result_zalo_status = 'accepted',
                result_zalo_msg_id = $3, result_zalo_error = NULL, updated_at = NOW()
          WHERE event_id = $1 AND student_unique_id = $2`,
        [eventId, studentId, msgId]
      );
    } else if (zres.reason !== 'zalo_not_configured') {
      await pool.query(
        `UPDATE event_attendees
            SET result_zalo_status = 'failed', result_zalo_error = $3, updated_at = NOW()
          WHERE event_id = $1 AND student_unique_id = $2`,
        [eventId, studentId, zres.detail || zres.reason || 'error']
      );
    }
  } catch (e) {
    console.error('[event-console] stone-result zalo:', e.message);
  }
}

// POST /profile/:token — save the student's answers back to their lead, then
// recalculate their evaluation (stone). The fresh evaluation is returned to the
// page (thank-you reveal) and sent to the student via e-mail + Zalo.
router.post('/profile/:token', async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ success: false, error: 'Missing link code' });
  const incoming = (req.body.fields && typeof req.body.fields === 'object') ? req.body.fields : null;
  if (!incoming) return res.status(400).json({ success: false, error: 'No answers submitted' });
  try {
    const r = await pool.query(
      `SELECT student_unique_id FROM event_attendees WHERE attendance_token = $1 LIMIT 1`,
      [token]
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'Link not recognised' });
    const uid = r.rows[0].student_unique_id;

    const cat = await pool.query(`SELECT field_key FROM event_qualification_fields`);
    const allowed = new Set(cat.rows.map((x) => x.field_key).filter((k) => !PROFILE_EXCLUDE.includes(k)));
    const saved = await persistQualificationFields(pool, uid, incoming, allowed);
    if (!saved) return res.status(400).json({ success: false, error: 'Nothing to save' });

    // Evaluate the questionnaire. Never let scoring break the save — the
    // student's answers are already committed at this point. The follow-up
    // e-mail/Zalo is NOT sent here: the page renders the updated stone-centred
    // badge and posts it to /profile/:token/badge, which sends the follow-up
    // with that badge attached.
    let evaluation = null;
    try {
      const risk = await recalcStone(uid);
      if (risk && isStoneTier(risk.stoneTier)) {
        const stone = stoneContent(risk.stoneTier, 'vi', publicBase());
        evaluation = { ...stone, score: risk.totalScore, maxScore: risk.maxScore };
      }
    } catch (e) {
      console.error('[event-console] profile recalc:', e.message);
    }

    res.json({ success: true, data: { evaluation } });
  } catch (err) {
    console.error('[event-console] profile save:', err);
    res.status(500).json({ success: false, error: 'Failed to save your answers' });
  }
});

// POST /profile/:token/badge — the page posts the freshly rendered
// stone-centred badge PNG right after a questionnaire submit. We store it
// (badge_png feeds /badge-image/:token) and send the follow-up communication:
// updated badge + stone banner + thank-you, via e-mail and Zalo.
router.post('/profile/:token/badge', async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ success: false, error: 'Missing link code' });
  const badgePng = String(req.body.badgePng || '').trim();
  if (!badgePng) return res.status(400).json({ success: false, error: 'badgePng is required' });
  if (badgePng.length > 2 * 1024 * 1024) {
    return res.status(400).json({ success: false, error: 'Badge image too large' });
  }
  try {
    const r = await pool.query(
      `UPDATE event_attendees ea
          SET badge_png = $2, updated_at = NOW()
         FROM students s
        WHERE ea.attendance_token = $1 AND s.student_id = ea.student_unique_id
        RETURNING s.stone_tier`,
      [token, badgePng]
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'Link not recognised' });

    const tier = r.rows[0].stone_tier;
    if (isStoneTier(tier)) {
      const stone = stoneContent(tier, 'vi', publicBase());
      sendEvaluationMessages({ token, stone, origin: req.get('origin') || '', badgePng })
        .catch((e) => console.error('[event-console] evaluation send:', e.message));
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[event-console] profile badge:', err);
    res.status(500).json({ success: false, error: 'Failed to store your badge' });
  }
});

// GET /badge-image/:token -- PUBLIC (no auth). Serves the stored badge PNG so
// it can be embedded as a single <img> in the badge email. Gmail's image proxy
// fetches this when the student opens the email. Token is an unguessable UUID.
router.get('/badge-image/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).send('Bad request');
    const r = await pool.query(
      `SELECT badge_png FROM event_attendees WHERE attendance_token = $1 LIMIT 1`,
      [token]
    );
    if (r.rowCount === 0 || !r.rows[0].badge_png) {
      return res.status(404).send('Not found');
    }
    const buf = Buffer.from(r.rows[0].badge_png, 'base64');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(buf);
  } catch (err) {
    console.error('[event-console] badge-image:', err);
    return res.status(500).send('Error');
  }
});

// GET /stone-image/:tier -- PUBLIC (no auth). Serves the stone-tier PNG so the
// evaluation e-mails can embed it as a plain <img>. Tier is whitelisted against
// the canonical names, so no path input ever reaches the filesystem.
router.get('/stone-image/:tier', (req, res) => {
  const tier = String(req.params.tier || '').trim();
  if (!isStoneTier(tier)) return res.status(404).send('Not found');
  res.set('Cache-Control', 'public, max-age=604800');
  res.sendFile(path.join(__dirname, '..', 'assets', 'stones', `${tier.toLowerCase()}.png`), (err) => {
    if (err && !res.headersSent) res.status(404).send('Not found');
  });
});

// POST /events/:id/issue-token/:studentId -- unconditionally mint (or return
// the existing) advance attendance token for a registrant, so ANY registrant
// can be sent their badge + form link. No qualification gate here —
// qualification is enforced at check-in. Idempotent via COALESCE.
router.post('/events/:id/issue-token/:studentId', requireStaffAuth, async (req, res) => {
  const eventId  = parseInt(req.params.id, 10);
  const studentId = String(req.params.studentId || '').trim();
  if (isNaN(eventId) || !studentId) {
    return res.status(400).json({ success: false, error: 'Invalid event id or student id' });
  }
  try {
    const token = crypto.randomUUID();
    const up = await pool.query(
      `INSERT INTO event_attendees
              (event_id, student_unique_id, registered_at, attendance_token)
            VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (event_id, student_unique_id) DO UPDATE
            SET attendance_token = COALESCE(event_attendees.attendance_token, EXCLUDED.attendance_token),
                updated_at       = NOW()
       RETURNING attendance_token`,
      [eventId, studentId, token]
    );
    res.json({ success: true, data: { attendanceToken: up.rows[0].attendance_token } });
  } catch (err) {
    console.error('[event-console] issue-token:', err);
    res.status(500).json({ success: false, error: 'Failed to issue token' });
  }
});

// POST /email-badge -- email a rendered registration badge to a student.
// The badge PNG is rendered client-side (shared badgeRenderer) and posted here
// as base64. We resolve the real (unmasked) email from the students row unless
// an override is supplied, send via the GAS relay, and stamp the attendee row.
// Body: { studentId, eventId, badgePng (base64, no data: prefix), email? (override), badgeUrl? }
router.post('/email-badge', requireStaffAuth, async (req, res) => {
  const studentId      = String(req.body.studentId || '').trim();
  const eventId       = parseInt(req.body.eventId, 10);
  const badgePng      = String(req.body.badgePng || '').trim();
  const overrideEmail = String(req.body.email || '').trim();
  const badgeUrl      = String(req.body.badgeUrl || '').trim();

  if (!studentId || isNaN(eventId) || !badgePng) {
    return res.status(400).json({ success: false, error: 'studentId, eventId and badgePng are required' });
  }

  try {
    // Mint an advance token if this student doesn't have one yet — any
    // registrant can be sent their badge + form (qualification is enforced at
    // check-in, not here). Idempotent: keeps an existing token via COALESCE.
    const mintToken = crypto.randomUUID();
    const att = await pool.query(
      `INSERT INTO event_attendees
              (event_id, student_unique_id, registered_at, attendance_token)
            VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (event_id, student_unique_id) DO UPDATE
            SET attendance_token = COALESCE(event_attendees.attendance_token, EXCLUDED.attendance_token),
                updated_at       = NOW()
       RETURNING attendance_token`,
      [eventId, studentId, mintToken]
    );

    // Real (unmasked) name + email straight from the students row. The full row
    // rides along: stone_tier drives the stone banner, and the qualification
    // gate (checkStudent) decides which questionnaire copy the e-mail shows
    // ("please complete" vs "review/update your answers").
    const sres = await pool.query(
      `SELECT * FROM students WHERE student_id = $1 LIMIT 1`,
      [studentId]
    );
    if (sres.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    const studentName = sres.rows[0].full_name || '';
    const recipient   = overrideEmail || String(sres.rows[0].email || '').trim();
    if (!recipient) {
      return res.status(400).json({ success: false, error: 'No email address on file; provide one to send to' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return res.status(400).json({ success: false, error: 'That email address looks invalid - please check it.' });
    }

    const ev = await pool.query(`SELECT name FROM events WHERE id = $1 LIMIT 1`, [eventId]);
    const eventName = ev.rowCount ? (ev.rows[0].name || '') : '';

    // Public URL where Gmail will fetch the badge image when the student opens
    // the email. Token is an unguessable UUID, so the route can be public.
    const attToken = att.rows[0].attendance_token;
    const PUBLIC_BASE = publicBase();
    // Hosted badge URL only on PROD (?v busts mail-proxy caches when the badge
    // is later re-rendered with the stone). On dev the URL would point at PROD
    // with a dev-only token, so we send no URL — the GAS relay then falls back
    // to attaching the PNG inline, keeping dev e-mails testable.
    const badgeImageUrl = process.env.NODE_ENV === 'production'
      ? `${PUBLIC_BASE}/api/event-console/badge-image/${attToken}?v=${Date.now()}`
      : '';

    // Stone banner content (null when unscored -> e-mail renders as before).
    const stone = stoneContent(sres.rows[0].stone_tier, 'vi', PUBLIC_BASE);

    // Has the student answered every required questionnaire field?
    let questionnaireComplete = false;
    try { questionnaireComplete = (await checkStudent(pool, sres.rows[0])).qualified; } catch (_) {}

    // Public "Know you better" form link — pre-fills known fields, lets the
    // student complete the rest, Submit writes back to their lead. Base URL is
    // the LQ/Client host, supplied by the caller (mirrors the rep-link route).
    const lqBase = String(req.body.baseUrl || '').trim().replace(/\/+$/, '');
    const profileUrl = /^https?:\/\//i.test(lqBase)
      ? `${lqBase}/profile?t=${encodeURIComponent(attToken)}`
      : '';

    // Store the rendered badge BEFORE sending: the e-mail shows it via the
    // public /badge-image/:token URL (no attachment -> mail clients can't
    // render a duplicate thumbnail of it at the end of the message).
    await pool.query(
      `UPDATE event_attendees
          SET badge_png = $3, updated_at = NOW()
        WHERE event_id = $1 AND student_unique_id = $2`,
      [eventId, studentId, badgePng]
    );

    await sendEventQrEmail(recipient, {
      name: studentName,
      eventName,
      badgeUrl,
      badgeImageUrl,
      badgePngBase64: badgePng,   // legacy fallback while the old GAS template is live
      profileUrl,
      stone,
      questionnaireComplete,
    });

    const upd = await pool.query(
      `UPDATE event_attendees
          SET badge_emailed_at = NOW(), badge_emailed_to = $3, updated_at = NOW()
        WHERE event_id = $1 AND student_unique_id = $2
        RETURNING badge_emailed_at, badge_emailed_to`,
      [eventId, studentId, recipient]
    );

    res.json({ success: true, data: upd.rows[0] || { badge_emailed_to: recipient } });
  } catch (err) {
    console.error('[event-console] email-badge:', err);
    res.status(500).json({ success: false, error: 'Failed to email badge' });
  }
});

// ── POST /zalo-badge ── send a registration badge to a student via Zalo.
// Mirrors /email-badge but delivers over Zalo (ZNS by phone, or OA message by
// user_id) instead of email. No badgePng needed: the Zalo message carries a
// link to the /profile?t=<token> page, which renders the badge QR itself.
// Body: { studentId, eventId, baseUrl, method? ('zns'|'oa') }
router.post('/zalo-badge', requireStaffAuth, async (req, res) => {
  const studentId = String(req.body.studentId || '').trim();
  const eventId  = parseInt(req.body.eventId, 10);
  const method   = String(req.body.method || '').trim().toLowerCase() || undefined;

  if (!studentId || isNaN(eventId)) {
    return res.status(400).json({ success: false, error: 'studentId and eventId are required' });
  }

  try {
    const mintToken = crypto.randomUUID();
    const att = await pool.query(
      `INSERT INTO event_attendees
              (event_id, student_unique_id, registered_at, attendance_token)
            VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (event_id, student_unique_id) DO UPDATE
            SET attendance_token = COALESCE(event_attendees.attendance_token, EXCLUDED.attendance_token),
                updated_at       = NOW()
       RETURNING attendance_token`,
      [eventId, studentId, mintToken]
    );

    const sres = await pool.query(
      `SELECT full_name, phone FROM students WHERE student_id = $1 LIMIT 1`,
      [studentId]
    );
    if (sres.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    const studentName = sres.rows[0].full_name || '';
    const phone       = String(sres.rows[0].phone || '').trim();

    const ev = await pool.query(`SELECT name FROM events WHERE id = $1 LIMIT 1`, [eventId]);
    const eventName = ev.rowCount ? (ev.rows[0].name || '') : '';

    const attToken = att.rows[0].attendance_token;
    const lqBase = String(req.body.baseUrl || '').trim().replace(/\/+$/, '');
    const profileUrl = /^https?:\/\//i.test(lqBase)
      ? `${lqBase}/profile?t=${encodeURIComponent(attToken)}`
      : '';

    const result = await sendEventBadge({
      method,
      phone,
      name: studentName,
      eventName,
      profileUrl,                  // used by the OA free-form path
      registrationCode: studentId, // ZNS "Mã đăng ký" (Sales ID)
      token: attToken,             // ZNS button URL: /profile?t=<token>
    });

    if (!result.sent) {
      console.warn('[event-console] zalo-badge NOT SENT:', JSON.stringify({ reason: result.reason, detail: result.detail, raw: result.raw }));
      const why = result.detail || result.reason || 'error';
      await pool.query(
        `UPDATE event_attendees
            SET badge_zalo_status = 'failed', badge_zalo_error = $3, updated_at = NOW()
          WHERE event_id = $1 AND student_unique_id = $2`,
        [eventId, studentId, why]
      ).catch((e) => console.error('[event-console] zalo-badge status(fail) write:', e.message));
      return res.status(200).json({
        success: false,
        error: result.detail || 'Could not send via Zalo',
        reason: result.reason,
      });
    }

    // Zalo accepted it. Capture the message id so Phase 2 (delivery webhook) can
    // match the "user received" event back to this attendee.
    const msgId = (result.raw && result.raw.data && (result.raw.data.msg_id || result.raw.data.message_id)) || null;
    const upd = await pool.query(
      `UPDATE event_attendees
          SET badge_zalo_sent_at      = NOW(),
              badge_zalo_status       = 'accepted',
              badge_zalo_msg_id       = $3,
              badge_zalo_error        = NULL,
              badge_zalo_delivered_at = NULL,
              updated_at              = NOW()
        WHERE event_id = $1 AND student_unique_id = $2
        RETURNING badge_zalo_sent_at, badge_zalo_msg_id`,
      [eventId, studentId, msgId]
    );

    console.log('[event-console] zalo-badge SENT:', JSON.stringify({ to: result.to, msgId }));
    res.json({ success: true, data: upd.rows[0] || { badge_zalo_sent_at: new Date().toISOString(), badge_zalo_msg_id: msgId } });
  } catch (err) {
    console.error('[event-console] zalo-badge:', err);
    res.status(500).json({ success: false, error: 'Failed to send Zalo badge' });
  }
});

// Force a Zalo delivery-status poll now (the background poller also runs every
// couple minutes). Flips 'accepted' badges to 'delivered' where Zalo confirms.
router.post('/poll-zalo-delivery', requireStaffAuth, async (_req, res) => {
  try {
    const summary = await zaloDeliveryPoller.pollOnce({ verbose: true });
    res.json({ success: true, data: summary });
  } catch (err) {
    console.error('[event-console] poll-zalo-delivery:', err);
    res.status(500).json({ success: false, error: 'Poll failed' });
  }
});

// ── Feature 3: post-event follow-up (survey) ─────────────────────────────────
// Personalised per recipient (customer_name + customer_code=Sales ID) via the
// approved ZNS template 611671, with a Resend email backup that mirrors it.
// Mirrors the badge senders; stamps its own followup_* tracking columns.

// Ensure an event_attendees row exists so follow-up tracking has somewhere to
// live (a no-show may never have had a badge minted). Idempotent.
async function ensureAttendeeRow(eventId, studentId) {
  await pool.query(
    `INSERT INTO event_attendees
            (event_id, student_unique_id, registered_at, attendance_token)
          VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (event_id, student_unique_id) DO UPDATE
          SET attendance_token = COALESCE(event_attendees.attendance_token, EXCLUDED.attendance_token),
              updated_at       = NOW()`,
    [eventId, studentId, crypto.randomUUID()]
  );
}

// dd/mm/yyyy from a pg date/timestamp. Handles both the string form
// ('YYYY-MM-DD…') and a JS Date (UTC parts, so the calendar day never shifts
// under the server timezone). Returns '' if unparseable.
function fmtDmy(d) {
  if (!d) return '';
  if (typeof d === 'string') {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${parseInt(m[3], 10)}/${parseInt(m[2], 10)}/${m[1]}`;
  }
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt)) return '';
  return `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}/${dt.getUTCFullYear()}`;
}

// POST /zalo-followup — send the survey follow-up to one student via Zalo.
// Body: { studentId, eventId }
router.post('/zalo-followup', requireStaffAuth, async (req, res) => {
  const studentId = String(req.body.studentId || '').trim();
  const eventId  = parseInt(req.body.eventId, 10);
  if (!studentId || isNaN(eventId)) {
    return res.status(400).json({ success: false, error: 'studentId and eventId are required' });
  }

  try {
    const sres = await pool.query(
      `SELECT full_name, phone FROM students WHERE student_id = $1 LIMIT 1`,
      [studentId]
    );
    if (sres.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    await ensureAttendeeRow(eventId, studentId);

    const result = await sendEventFollowup({
      phone: String(sres.rows[0].phone || '').trim(),
      name: sres.rows[0].full_name || '',
      registrationCode: studentId,     // ZNS customer_code = Sales ID
    });

    if (!result.sent) {
      const why = result.detail || result.reason || 'error';
      await pool.query(
        `UPDATE event_attendees
            SET followup_zalo_status = 'failed', followup_zalo_error = $3, updated_at = NOW()
          WHERE event_id = $1 AND student_unique_id = $2`,
        [eventId, studentId, why]
      ).catch((e) => console.error('[event-console] zalo-followup status(fail):', e.message));
      return res.status(200).json({ success: false, error: why, reason: result.reason });
    }

    const msgId = (result.raw && result.raw.data && (result.raw.data.msg_id || result.raw.data.message_id)) || null;
    const upd = await pool.query(
      `UPDATE event_attendees
          SET followup_zalo_sent_at = NOW(),
              followup_zalo_status  = 'accepted',
              followup_zalo_msg_id  = $3,
              followup_zalo_error   = NULL,
              updated_at            = NOW()
        WHERE event_id = $1 AND student_unique_id = $2
        RETURNING followup_zalo_sent_at, followup_zalo_msg_id`,
      [eventId, studentId, msgId]
    );
    res.json({ success: true, data: upd.rows[0] || { followup_zalo_sent_at: new Date().toISOString() } });
  } catch (err) {
    console.error('[event-console] zalo-followup:', err);
    res.status(500).json({ success: false, error: 'Failed to send Zalo follow-up' });
  }
});

// POST /email-followup — send the survey follow-up to one student by email
// (Resend). Body: { studentId, eventId, email? }
router.post('/email-followup', requireStaffAuth, async (req, res) => {
  const studentId     = String(req.body.studentId || '').trim();
  const eventId       = parseInt(req.body.eventId, 10);
  const overrideEmail = String(req.body.email || '').trim();
  if (!studentId || isNaN(eventId)) {
    return res.status(400).json({ success: false, error: 'studentId and eventId are required' });
  }

  try {
    const sres = await pool.query(
      `SELECT full_name, email FROM students WHERE student_id = $1 LIMIT 1`,
      [studentId]
    );
    if (sres.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    const recipient = overrideEmail || String(sres.rows[0].email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return res.status(400).json({ success: false, error: 'No valid email address on file' });
    }

    const ev = await pool.query(`SELECT name, start_date, end_date FROM events WHERE id = $1 LIMIT 1`, [eventId]);
    const eventName = (process.env.EVENT_FOLLOWUP_EVENT_LABEL || (ev.rowCount ? ev.rows[0].name : '') || '').trim();
    // The fair day is the event's end date (e.g. 18/7), matching the Zalo copy;
    // fall back to start date if end is unset.
    const eventDate = ev.rowCount ? fmtDmy(ev.rows[0].end_date || ev.rows[0].start_date) : '';

    await ensureAttendeeRow(eventId, studentId);

    const result = await sendFollowupEmail(recipient, {
      name: sres.rows[0].full_name || '',
      customerCode: studentId,
      eventName,
      eventDate,
    });

    if (!result.sent) {
      return res.status(200).json({ success: false, error: result.detail || 'Could not send email', reason: result.reason });
    }

    const upd = await pool.query(
      `UPDATE event_attendees
          SET followup_emailed_at = NOW(), followup_emailed_to = $3, updated_at = NOW()
        WHERE event_id = $1 AND student_unique_id = $2
        RETURNING followup_emailed_at, followup_emailed_to`,
      [eventId, studentId, recipient]
    );
    res.json({ success: true, data: upd.rows[0] || { followup_emailed_to: recipient } });
  } catch (err) {
    console.error('[event-console] email-followup:', err);
    res.status(500).json({ success: false, error: 'Failed to email follow-up' });
  }
});

// ── Event reports (per-event uploaded + AI-generated report files) ──────────
// Manager/admin-gated (they contain contract-potential / advisory PII). Files
// stored as bytea; upload is base64 JSON (15mb body limit covers it). Generation
// runs the Anthropic API in the background (see runReportGeneration).
const { gatherEventReportData }   = require('../services/eventReportData');
const { generateNarrative }       = require('../services/eventReportGenerator');
const { buildEventReportWorkbook, workbookToBuffer } = require('../services/eventReportExcel');
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// GET /events/:id/reports — list metadata (no file bytes).
router.get('/events/:id/reports', requireEventReports, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, file_name, mime_type, byte_size, uploaded_by, uploaded_at, source, status, error
         FROM event_reports WHERE event_id = $1 ORDER BY uploaded_at DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[event-console] list reports:', err);
    res.status(500).json({ success: false, error: 'Failed to load reports' });
  }
});

// POST /events/:id/reports/generate — AI-generate the report (async background job).
router.post('/events/:id/reports/generate', requireEventReports, async (req, res) => {
  try {
    const mode = req.body && req.body.mode === 'data' ? 'data' : 'full';
    if (mode === 'full' && !process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ success: false, error: 'AI generation is not configured (no API key / credits). Use the data-only report for now.' });
    }
    const eventId = req.params.id;
    const ev = (await pool.query('SELECT name FROM events WHERE id = $1', [eventId])).rows[0];
    const stamp = new Date().toISOString().slice(0, 10);
    const label = mode === 'data' ? 'Event Report (data)' : 'Event Report';
    const fileName = `${label} - ${(ev?.name || ('event ' + eventId))} - ${stamp}.xlsx`;
    const ins = await pool.query(
      `INSERT INTO event_reports (event_id, file_name, mime_type, source, status, uploaded_by)
       VALUES ($1, $2, $3, 'generated', 'generating', $4) RETURNING id`,
      [eventId, fileName, XLSX_MIME, req.session.staffName || null]
    );
    const reportId = ins.rows[0].id;
    res.status(202).json({ success: true, data: { id: reportId, status: 'generating' } });
    // Fire-and-forget; status is tracked on the row and polled by the UI.
    runReportGeneration(eventId, reportId, mode).catch((e) => console.error('[event-report] generation:', e));
  } catch (err) {
    console.error('[event-console] start generate:', err);
    res.status(500).json({ success: false, error: 'Failed to start generation' });
  }
});

async function runReportGeneration(eventId, reportId, mode = 'full') {
  try {
    const data = await gatherEventReportData(eventId);
    const narrative = mode === 'data' ? {} : await generateNarrative(data);
    const wb  = buildEventReportWorkbook(data, narrative);
    const buf = await workbookToBuffer(wb);
    await pool.query(
      `UPDATE event_reports SET data = $1, byte_size = $2, status = 'ready', error = NULL WHERE id = $3`,
      [buf, buf.length, reportId]
    );
    console.log(`[event-report] generated report ${reportId} for event ${eventId} (${buf.length} bytes, ${narrative.batches} batches)`);
  } catch (e) {
    await pool.query(`UPDATE event_reports SET status = 'failed', error = $1 WHERE id = $2`,
      [String(e && e.message || e).slice(0, 500), reportId]).catch(() => {});
  }
}

// POST /events/:id/reports — { fileName, mimeType, dataBase64 }
router.post('/events/:id/reports', requireEventReports, async (req, res) => {
  try {
    const fileName = String(req.body.fileName || '').trim();
    const dataB64  = req.body.dataBase64 || '';
    if (!fileName || !dataB64) {
      return res.status(400).json({ success: false, error: 'fileName and dataBase64 are required' });
    }
    const buf = Buffer.from(dataB64, 'base64');
    if (!buf.length) return res.status(400).json({ success: false, error: 'Empty file' });
    if (buf.length > 12 * 1024 * 1024) {
      return res.status(413).json({ success: false, error: 'File too large (max 12MB)' });
    }
    const r = await pool.query(
      `INSERT INTO event_reports (event_id, file_name, mime_type, byte_size, data, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, file_name, mime_type, byte_size, uploaded_by, uploaded_at`,
      [req.params.id, fileName, req.body.mimeType || null, buf.length, buf, req.session.staffName || null]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    console.error('[event-console] upload report:', err);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// GET /events/:id/reports/:reportId/download — stream the file back.
router.get('/events/:id/reports/:reportId/download', requireEventReports, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT file_name, mime_type, data FROM event_reports WHERE id = $1 AND event_id = $2`,
      [req.params.reportId, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, error: 'Report not found' });
    const row = r.rows[0];
    if (!row.data) return res.status(409).json({ success: false, error: 'Report is not ready yet' });
    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition',
      `attachment; filename="${encodeURIComponent(row.file_name).replace(/['()]/g, '')}"`);
    res.send(row.data);
  } catch (err) {
    console.error('[event-console] download report:', err);
    res.status(500).json({ success: false, error: 'Download failed' });
  }
});

// DELETE /events/:id/reports/:reportId
router.delete('/events/:id/reports/:reportId', requireEventReports, async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM event_reports WHERE id = $1 AND event_id = $2`,
      [req.params.reportId, req.params.id]
    );
    res.json({ success: true, deleted: r.rowCount });
  } catch (err) {
    console.error('[event-console] delete report:', err);
    res.status(500).json({ success: false, error: 'Delete failed' });
  }
});

// ── Event Report dashboard (LM console: Report -> Event Report) ────────────
// Lead-source breakdown, cross-event comparison, and the budget/CPL ledger.
// Gated by requireEventAnalytics (Executives + Managers only — narrower than
// the file-based reports above, per explicit request to exclude Leads/Data
// Quality from this specific dashboard).
const { gatherSourceBreakdown, setSourceSpend } = require('../services/eventSourceBreakdown');
const eventBudget = require('../services/eventBudget');
const eventSponsors = require('../services/eventSponsors');
const eventBudgetApproval = require('../services/eventBudgetApproval');
const { buildBudgetApprovalPdf } = require('../services/budgetPdf');
const { cfg: budgetApprovalEmailCfg } = require('../services/budgetApprovalEmail');

// Filename-safe slug for the budget-approval PDF: strips diacritics (Windows/
// some tools mishandle Unicode filenames) and anything that isn't
// alphanumeric into hyphens.
function slugifyFilename(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

// GET /events/:id/source-report — single-event breakdown + KPIs + Số trường.
router.get('/events/:id/source-report', requireEventAnalytics, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });
  try {
    const data = await gatherSourceBreakdown([id]);
    res.json({ success: true, data: { ...data, event: data.events[0] || null } });
  } catch (err) {
    console.error('[event-console] source-report:', err);
    res.status(500).json({ success: false, error: 'Failed to load source report' });
  }
});

// GET /events-compare?ids=1,2,3 — event-level totals for the Compare view.
// NOTE: deliberately NOT nested under /events/... — the pre-existing
// /events/:id route above would swallow /events/compare with id='compare'.
router.get('/events-compare', requireEventAnalytics, async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!ids.length) return res.status(400).json({ success: false, error: 'ids query param is required' });
  try {
    const data = await gatherSourceBreakdown(ids);
    res.json({ success: true, data: { events: data.events } });
  } catch (err) {
    console.error('[event-console] events-compare:', err);
    res.status(500).json({ success: false, error: 'Failed to load comparison' });
  }
});

// GET /events/:id/budget — ledger + totals (+ derived 85%/remaining figures).
router.get('/events/:id/budget', requireEventAnalytics, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });
  try {
    const canApprove = eventBudgetApproval.isApprover(req.session.staffEmail);
    const data = await eventBudget.getBudget(id, canApprove);
    if (!data) return res.status(404).json({ success: false, error: 'Event not found' });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[event-console] get budget:', err);
    res.status(500).json({ success: false, error: 'Failed to load budget' });
  }
});

// PUT /events/:id/budget-totals — set total_sponsorship / khach_k_count.
// (Total cost is no longer stored here — it's computed from event_budget_items.)
router.put('/events/:id/budget-totals', requireEventAnalytics, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });
  try {
    const canApprove = eventBudgetApproval.isApprover(req.session.staffEmail);
    const data = await eventBudget.setTotals(id, req.body || {}, canApprove);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[event-console] set budget totals:', err);
    res.status(500).json({ success: false, error: 'Failed to save budget totals' });
  }
});

// POST /events/:id/budget-items — add a line item.
router.post('/events/:id/budget-items', requireEventAnalytics, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });
  try {
    const item = await eventBudget.addItem(id, req.body || {});
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    console.error('[event-console] add budget item:', err);
    res.status(400).json({ success: false, error: err.message || 'Failed to add budget item' });
  }
});

// PUT /events/:id/budget-items/:itemId — edit a line item.
router.put('/events/:id/budget-items/:itemId', requireEventAnalytics, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const itemId = parseInt(req.params.itemId, 10);
  if (isNaN(id) || isNaN(itemId)) return res.status(400).json({ success: false, error: 'Invalid id' });
  try {
    const item = await eventBudget.updateItem(id, itemId, req.body || {});
    if (!item) return res.status(404).json({ success: false, error: 'Budget item not found' });
    res.json({ success: true, data: item });
  } catch (err) {
    console.error('[event-console] update budget item:', err);
    res.status(400).json({ success: false, error: err.message || 'Failed to update budget item' });
  }
});

// DELETE /events/:id/budget-items/:itemId
router.delete('/events/:id/budget-items/:itemId', requireEventAnalytics, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const itemId = parseInt(req.params.itemId, 10);
  if (isNaN(id) || isNaN(itemId)) return res.status(400).json({ success: false, error: 'Invalid id' });
  try {
    const deleted = await eventBudget.deleteItem(id, itemId);
    res.json({ success: true, deleted });
  } catch (err) {
    console.error('[event-console] delete budget item:', err);
    res.status(500).json({ success: false, error: 'Failed to delete budget item' });
  }
});

// POST /events/:id/budget-import — parse the team's real budget spreadsheet
// export (raw CSV text in the body) and replace the line items for whichever
// budget type(s) the file contains. Body: { csvText }.
router.post('/events/:id/budget-import', requireEventAnalytics, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });
  const csvText = req.body && req.body.csvText;
  if (!csvText || typeof csvText !== 'string') {
    return res.status(400).json({ success: false, error: 'csvText is required' });
  }
  try {
    const canApprove = eventBudgetApproval.isApprover(req.session.staffEmail);
    const result = await eventBudget.importBudgetCsv(id, csvText, canApprove);
    res.json({ success: true, data: result.budget, summary: result.summary });
  } catch (err) {
    console.error('[event-console] budget import:', err);
    res.status(400).json({ success: false, error: err.message || 'Failed to import budget CSV' });
  }
});

// PUT /events/:id/budget-approval-note — mom-only. Writes the same note to
// up to 2 underlying items (a merged row's planned + actual ids).
// Body: { itemIds: number[], note: string }.
router.put('/events/:id/budget-approval-note', requireEventAnalytics, requireBudgetApprover, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });
  const itemIds = Array.isArray(req.body?.itemIds) ? req.body.itemIds.map(Number) : [];
  try {
    const rows = await eventBudgetApproval.saveApprovalNote(id, itemIds, req.body?.note, req.session.staffName);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[event-console] save budget approval note:', err);
    res.status(400).json({ success: false, error: err.message || 'Failed to save approval note' });
  }
});

// POST /events/:id/budget-approve — mom-only. Stamps the approval, builds
// the PDF, and returns it (base64) for the browser to download — no email is
// sent server-side. Mom reviews/edits in a Gmail compose draft the frontend
// opens, attaching the just-downloaded PDF herself before sending; no
// service is ever allowed to auto-attach a file to someone's email draft via
// a link, so this manual-attach step is unavoidable, not an oversight.
// Body: { budgetType: 'planned' | 'actual' }.
router.post('/events/:id/budget-approve', requireEventAnalytics, requireBudgetApprover, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });
  const budgetType = req.body && req.body.budgetType;
  if (!eventBudgetApproval.BUDGET_TYPES.has(budgetType)) {
    return res.status(400).json({ success: false, error: "budgetType must be 'planned' or 'actual'" });
  }
  try {
    const approval = await eventBudgetApproval.approveBudget(id, budgetType, req.session.staffName);

    let pdf = null;
    try {
      const pdfBuffer = await buildBudgetApprovalPdf(approval);
      const approvedDate = new Date(approval.approvedAt).toISOString().slice(0, 10); // YYYY-MM-DD
      const eventSlug = slugifyFilename(approval.event.name) || `event-${approval.event.id}`;
      pdf = { base64: pdfBuffer.toString('base64'), filename: `${eventSlug}-${budgetType}-${approvedDate}.pdf` };
    } catch (pdfErr) {
      console.error('[event-console] budget approval PDF build failed:', pdfErr);
    }

    const canApprove = true; // requireBudgetApprover already confirmed this
    const data = await eventBudget.getBudget(id, canApprove);
    res.json({
      success: true,
      data,
      pdf,
      notifyEmails: budgetApprovalEmailCfg().recipients,
      approval: { eventName: approval.event.name, budgetType: approval.budgetType, approvedBy: approval.approvedBy, approvedAt: approval.approvedAt, total: approval.total },
    });
  } catch (err) {
    console.error('[event-console] approve budget:', err);
    res.status(400).json({ success: false, error: err.message || 'Failed to approve budget' });
  }
});

// ── School sponsors — per-institution breakdown behind Total Sponsorship ──
// GET /events/:id/sponsors
router.get('/events/:id/sponsors', requireEventAnalytics, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });
  try {
    const data = await eventSponsors.getSponsors(id);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[event-console] get sponsors:', err);
    res.status(500).json({ success: false, error: 'Failed to load sponsors' });
  }
});

// POST /events/:id/sponsors — add one institution's contribution.
router.post('/events/:id/sponsors', requireEventAnalytics, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });
  try {
    const itemId = await eventSponsors.addItem(id, req.body || {});
    res.status(201).json({ success: true, data: await eventSponsors.getSponsors(id), itemId });
  } catch (err) {
    console.error('[event-console] add sponsor:', err);
    res.status(400).json({ success: false, error: err.message || 'Failed to add sponsor' });
  }
});

// PUT /events/:id/sponsors/:itemId
router.put('/events/:id/sponsors/:itemId', requireEventAnalytics, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const itemId = parseInt(req.params.itemId, 10);
  if (isNaN(id) || isNaN(itemId)) return res.status(400).json({ success: false, error: 'Invalid id' });
  try {
    const ok = await eventSponsors.updateItem(id, itemId, req.body || {});
    if (!ok) return res.status(404).json({ success: false, error: 'Sponsor row not found' });
    res.json({ success: true, data: await eventSponsors.getSponsors(id) });
  } catch (err) {
    console.error('[event-console] update sponsor:', err);
    res.status(400).json({ success: false, error: err.message || 'Failed to update sponsor' });
  }
});

// DELETE /events/:id/sponsors/:itemId
router.delete('/events/:id/sponsors/:itemId', requireEventAnalytics, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const itemId = parseInt(req.params.itemId, 10);
  if (isNaN(id) || isNaN(itemId)) return res.status(400).json({ success: false, error: 'Invalid id' });
  try {
    const deleted = await eventSponsors.deleteItem(id, itemId);
    res.json({ success: true, deleted, data: await eventSponsors.getSponsors(id) });
  } catch (err) {
    console.error('[event-console] delete sponsor:', err);
    res.status(500).json({ success: false, error: 'Failed to delete sponsor' });
  }
});

// POST /events/:id/sponsors-import — parse the team's "school sponsor list"
// spreadsheet tab (raw CSV text in the body) and replace the full list.
router.post('/events/:id/sponsors-import', requireEventAnalytics, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });
  const csvText = req.body && req.body.csvText;
  if (!csvText || typeof csvText !== 'string') {
    return res.status(400).json({ success: false, error: 'csvText is required' });
  }
  try {
    const result = await eventSponsors.importSponsorsCsv(id, csvText);
    res.json({ success: true, data: result.sponsors, count: result.count });
  } catch (err) {
    console.error('[event-console] sponsors import:', err);
    res.status(400).json({ success: false, error: err.message || 'Failed to import sponsors CSV' });
  }
});

// PUT /events/:id/source-spend — upsert the manual spend figure for one
// source-breakdown row. Body: { sourceLabel, amount }.
router.put('/events/:id/source-spend', requireEventAnalytics, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });
  const sourceLabel = String((req.body && req.body.sourceLabel) || '').trim();
  if (!sourceLabel) return res.status(400).json({ success: false, error: 'sourceLabel is required' });
  try {
    await setSourceSpend(id, sourceLabel, req.body.amount ?? null, req.session.staffName);
    res.json({ success: true });
  } catch (err) {
    console.error('[event-console] set source spend:', err);
    res.status(500).json({ success: false, error: 'Failed to save spend' });
  }
});

module.exports = router;

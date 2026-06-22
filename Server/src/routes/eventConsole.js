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
const { Pool } = require('pg');
const { clearQualificationCache, checkStudent } = require('../services/eventQualification');
const { sendEventQrEmail, sendRepLinkEmail } = require('../services/emailService');

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
      `SELECT le.student_id              AS unique_id,
              s.full_name,
              s.email,
              s.phone,
              le.status,
              ea.attended_at,
              ea.attendance_token,
              ea.badge_emailed_at,
              ea.badge_emailed_to,
              ea.checked_in_by,
              ci.full_name               AS checked_in_by_name
         FROM (
               SELECT DISTINCT ON (student_id) student_id, status
                 FROM lead_events
                WHERE event_id = $1
                ORDER BY student_id, created_at ASC
              ) le
         JOIN students s              ON s.unique_id = le.student_id
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
// re-check-in keeps the original attended_at and token. Body: { uniqueId }.
router.post('/events/:id/checkin', requireStaffAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid event id' });

  const uniqueId = (req.body.uniqueId || req.body.unique_id || '').trim();
  if (!uniqueId) return res.status(400).json({ success: false, error: 'uniqueId is required' });

  try {
    // Must be on this event's roster (registered in lead_events).
    const reg = await pool.query(
      `SELECT 1 FROM lead_events WHERE event_id = $1 AND student_id = $2 LIMIT 1`,
      [id, uniqueId]
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
      const sets = [], vals = [];
      let i = 1;
      for (const [k, v] of Object.entries(incoming)) {
        if (!allowed.has(k)) continue;
        sets.push(`${k} = $${i++}`);
        vals.push(v === '' ? null : v);
      }
      if (sets.length) {
        vals.push(uniqueId);
        await pool.query(`UPDATE students SET ${sets.join(', ')}, updated_at = NOW() WHERE unique_id = $${i}`, vals);
      }
    }

    // HARD GATE: cannot complete check-in while any required field is missing.
    const sres = await pool.query(`SELECT * FROM students WHERE unique_id = $1 LIMIT 1`, [uniqueId]);
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
      [id, uniqueId, checkedInBy, token]
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

const DESK_ADMIN_ROLES = new Set(['Admin', 'Manager', 'Director']);
function requireDeskAdmin(req, res, next) {
  if (!req.session || !req.session.staffId) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (!DESK_ADMIN_ROLES.has(req.session.staffRole)) {
    return res.status(403).json({ success: false, error: 'Insufficient role' });
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

async function repRow(repId) {
  const r = await pool.query(
    `SELECT s.id, s.full_name, s.position, s.institution_id, i.name AS institution_name,
            s.event_login_token, s.event_pin, s.valid_from, s.valid_until, s.is_active,
            s.source_staff_id
       FROM staff s LEFT JOIN institutions i ON i.id = s.institution_id
      WHERE s.id = $1`,
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
      `SELECT s.id, s.full_name, s.position, s.institution_id, i.name AS institution_name,
              s.event_login_token, s.event_pin, s.valid_from, s.valid_until, s.is_active,
              s.source_staff_id
         FROM staff s LEFT JOIN institutions i ON i.id = s.institution_id
        WHERE s.staff_type = 'event' AND s.event_id = $1
        ORDER BY s.is_active DESC, s.full_name ASC`,
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
    return res.status(400).json({ success: false, error: 'Institution reps need an institution (or set type to StudyLink for roving)' });
  }

  try {
    // Preferred: assign a real staff member. Copy their name onto the
    // event-staff row and link back via source_staff_id (for email/phone/Zalo).
    let sourceStaffId = null;
    if (staffId) {
      const s = await pool.query(
        `SELECT full_name FROM staff WHERE id = $1 AND staff_type <> 'event' AND is_active = true`,
        [staffId]
      );
      if (s.rowCount === 0) return res.status(404).json({ success: false, error: 'Staff member not found or not selectable' });
      fullName = s.rows[0].full_name;
      sourceStaffId = staffId;
    }
    if (!fullName) return res.status(400).json({ success: false, error: 'Pick a staff member' });

    if (institutionId) {
      const chk = await pool.query(`SELECT 1 FROM institutions WHERE id = $1`, [institutionId]);
      if (chk.rowCount === 0) return res.status(404).json({ success: false, error: 'Institution not found' });
    }
    const token = crypto.randomUUID();
    const pin   = genDeskPin();
    const email = `evt-${token}@reps.local`;   // synthetic: staff.email is NOT NULL + unique

    const ins = await pool.query(
      `INSERT INTO staff
         (full_name, email, position, role, staff_type, event_id, institution_id,
          valid_from, valid_until, event_login_token, event_pin, source_staff_id, is_active, created_at)
       VALUES ($1, $2, $3, 'Event staff', 'event', $4, $5, $6, $7, $8, $9, $10, true, NOW())
       RETURNING id`,
      [fullName, email, POSITION_BY_KIND[kind], id, institutionId, validFrom, validUntil, token, pin, sourceStaffId]
    );
    res.json({ success: true, data: await repRow(ins.rows[0].id) });
  } catch (err) {
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
      `UPDATE staff SET ${sets.join(', ')} WHERE id = $${vals.length} AND staff_type = 'event' RETURNING id`,
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
      `UPDATE staff SET event_pin = $1 WHERE id = $2 AND staff_type = 'event' RETURNING id, event_pin`,
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
      `UPDATE staff SET is_active = false WHERE id = $1 AND staff_type = 'event' RETURNING id`,
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
      `SELECT id, full_name, event_login_token, event_pin, source_staff_id, is_active
         FROM staff
        WHERE id = $1 AND event_id = $2 AND staff_type = 'event' LIMIT 1`,
      [repId, id]
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'Rep not found' });
    const rep = r.rows[0];
    if (!rep.is_active) return res.status(400).json({ success: false, error: 'Rep is deactivated' });
    if (!rep.source_staff_id) {
      return res.status(400).json({ success: false, error: 'This rep is not linked to a staff member. Re-create them from the staff list to enable email.' });
    }

    const s = await pool.query(`SELECT email FROM staff WHERE id = $1`, [rep.source_staff_id]);
    const email = s.rows[0] && s.rows[0].email;
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
  if (req.session.staffRole !== 'Admin') {
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
async function buildCheckinFields(student) {
  const qf = await pool.query(
    `SELECT field_key, label FROM event_qualification_fields
      WHERE is_required = true ORDER BY sort_order`
  );
  const out = [];
  for (const f of qf.rows) {
    const lv = await pool.query(
      `SELECT code, COALESCE(NULLIF(label_en, ''), code) AS label
         FROM lookup_values
        WHERE category = $1 AND is_active = true
        ORDER BY sort_order, label_en`,
      [lookupCategoryFor(f.field_key)]
    );
    const options = lv.rows.map((x) => ({ value: x.code, label: x.label }));
    out.push({
      fieldKey: f.field_key,
      label: f.label,
      type: options.length ? 'select' : 'text',
      options,
      value: student[f.field_key] != null ? String(student[f.field_key]) : '',
    });
  }
  return out;
}

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

// GET /qualification-check/:uniqueId — dry-run the gate against a real student.
// Read-only diagnostic: returns { qualified, missing } using the current config.
router.get('/qualification-check/:uniqueId', requireStaffAuth, async (req, res) => {
  const uid = String(req.params.uniqueId || '').trim();
  if (!uid) return res.status(400).json({ success: false, error: 'uniqueId required' });
  try {
    const r = await pool.query(`SELECT * FROM students WHERE unique_id = $1 LIMIT 1`, [uid]);
    if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'Student not found' });
    const result = await checkStudent(pool, r.rows[0]);
    res.json({ success: true, data: { uniqueId: uid, ...result } });
  } catch (err) {
    console.error('[event-console] qualification-check:', err);
    res.status(500).json({ success: false, error: 'Check failed' });
  }
}); 

// GET /events/:id/checkin-fields/:uniqueId — the streamlined check-in form's
// data: every currently-required field with its label, input type, options
// (from lookup_values) and the student's current value, plus what's missing.
router.get('/events/:id/checkin-fields/:uniqueId', requireStaffAuth, async (req, res) => {
  const uid = String(req.params.uniqueId || '').trim();
  if (!uid) return res.status(400).json({ success: false, error: 'uniqueId required' });
  try {
    const sres = await pool.query(`SELECT * FROM students WHERE unique_id = $1 LIMIT 1`, [uid]);
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

// POST /email-badge -- email a rendered registration badge to a student.
// The badge PNG is rendered client-side (shared badgeRenderer) and posted here
// as base64. We resolve the real (unmasked) email from the students row unless
// an override is supplied, send via the GAS relay, and stamp the attendee row.
// Body: { uniqueId, eventId, badgePng (base64, no data: prefix), email? (override), badgeUrl? }
router.post('/email-badge', requireStaffAuth, async (req, res) => {
  const uniqueId      = String(req.body.uniqueId || '').trim();
  const eventId       = parseInt(req.body.eventId, 10);
  const badgePng      = String(req.body.badgePng || '').trim();
  const overrideEmail = String(req.body.email || '').trim();
  const badgeUrl      = String(req.body.badgeUrl || '').trim();

  if (!uniqueId || isNaN(eventId) || !badgePng) {
    return res.status(400).json({ success: false, error: 'uniqueId, eventId and badgePng are required' });
  }

  try {
    // Must have an advance token for this (event, student) before we email a badge.
    const att = await pool.query(
      `SELECT attendance_token FROM event_attendees
        WHERE event_id = $1 AND student_unique_id = $2 LIMIT 1`,
      [eventId, uniqueId]
    );
    if (att.rowCount === 0 || !att.rows[0].attendance_token) {
      return res.status(400).json({ success: false, error: 'No advance badge token for this student at this event' });
    }

    // Real (unmasked) name + email straight from the students row.
    const sres = await pool.query(
      `SELECT full_name, email FROM students WHERE unique_id = $1 LIMIT 1`,
      [uniqueId]
    );
    if (sres.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    const studentName = sres.rows[0].full_name || '';
    const recipient   = overrideEmail || String(sres.rows[0].email || '').trim();
    if (!recipient) {
      return res.status(400).json({ success: false, error: 'No email address on file; provide one to send to' });
    }

    const ev = await pool.query(`SELECT name FROM events WHERE id = $1 LIMIT 1`, [eventId]);
    const eventName = ev.rowCount ? (ev.rows[0].name || '') : '';

    // Public URL where Gmail will fetch the badge image when the student opens
    // the email. Token is an unguessable UUID, so the route can be public.
    const attToken = att.rows[0].attendance_token;
    const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL
      || 'https://studylinkleadqualification-production.up.railway.app').replace(/\/+$/, '');
    const badgeImageUrl = `${PUBLIC_BASE}/api/event-console/badge-image/${attToken}`;

    await sendEventQrEmail(recipient, {
      name: studentName,
      eventName,
      badgeUrl,
      badgeImageUrl,
      badgePngBase64: badgePng,
    });

    const upd = await pool.query(
      `UPDATE event_attendees
          SET badge_emailed_at = NOW(), badge_emailed_to = $3, badge_png = $4, updated_at = NOW()
        WHERE event_id = $1 AND student_unique_id = $2
        RETURNING badge_emailed_at, badge_emailed_to`,
      [eventId, uniqueId, recipient, badgePng]
    );

    res.json({ success: true, data: upd.rows[0] || { badge_emailed_to: recipient } });
  } catch (err) {
    console.error('[event-console] email-badge:', err);
    res.status(500).json({ success: false, error: 'Failed to email badge' });
  }
});

module.exports = router;

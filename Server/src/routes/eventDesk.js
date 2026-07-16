// C:/Users/rhod_/Documents/StudyLinkLeadQualification/Server/src/routes/eventDesk.js
// ─────────────────────────────────────────────────────────────────────
// Phase 2.2b/2.2c — PUBLIC desk router (mounted at /api/event-desk). No LM login.
// Rep opens ?rep=<event_login_token>, enters PIN → signed Bearer token.
// Then signs into a desk, scans a student (NAME ONLY), and logs a visit:
// a stamped note segment under the event topic + an event_desk_visits row.
// ─────────────────────────────────────────────────────────────────────

const express  = require('express');
const crypto   = require('crypto');
const { Pool } = require('pg');
const config   = require('../config');
const StudentNote = require('../models/StudentNote');
const { isStoneTier } = require('../utils/stoneContent');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const router = express.Router();

const SECRET   = (config.session && config.session.secret) || process.env.SESSION_SECRET || 'dev-desk-secret';
const TTL_MS   = 12 * 60 * 60 * 1000;   // 12 hours

// ── Signed auth token (HMAC) ─────────────────────────────────
function signRep(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyRep(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

// ── requireRep middleware ────────────────────────────────────
async function requireRep(req, res, next) {
  const hdr   = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : (req.body && req.body.authToken) || '';
  const payload = verifyRep(token);
  if (!payload) return res.status(401).json({ success: false, error: 'Session expired — sign in again' });
  try {
    // Bearer repId = event_reps.id (the link). Resolve to the real staff person;
    // req.rep.id stays the STAFF id so desk sessions + note authorship are correct.
    const r = await pool.query(
      `SELECT er.staff_id AS id, s.full_name, er.institution_id, er.event_id, er.is_active, er.valid_until
         FROM event_reps er JOIN staff s ON s.id = er.staff_id
        WHERE er.id = $1`,
      [payload.repId]
    );
    if (r.rowCount === 0 || !r.rows[0].is_active) {
      return res.status(403).json({ success: false, error: 'Account no longer active' });
    }
    const rep = r.rows[0];
    if (rep.valid_until && new Date() > new Date(rep.valid_until)) {
      return res.status(403).json({ success: false, error: 'This event has ended' });
    }
    req.rep = rep;
    next();
  } catch (err) {
    console.error('[event-desk] auth:', err);
    res.status(500).json({ success: false, error: 'Auth check failed' });
  }
}

// ── POST /login ──────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const token = (req.body.token || '').trim();
  const pin   = (req.body.pin   || '').trim();
  if (!token || !pin) return res.status(400).json({ success: false, error: 'Link and PIN are required' });

  try {
    const r = await pool.query(
      `SELECT er.id AS rep_link_id, er.staff_id, s.full_name, er.position, er.institution_id, i.name AS institution_name,
              er.event_id, er.event_pin, er.valid_from, er.valid_until, er.is_active
         FROM event_reps er
         JOIN staff s ON s.id = er.staff_id
         LEFT JOIN institutions i ON i.id = er.institution_id
        WHERE er.event_login_token = $1 LIMIT 1`,
      [token]
    );
    if (r.rowCount === 0) return res.status(401).json({ success: false, error: 'Invalid sign-in link' });

    const rep = r.rows[0];
    if (!rep.is_active) return res.status(403).json({ success: false, error: 'This account is no longer active' });
    if (String(rep.event_pin) !== String(pin)) return res.status(401).json({ success: false, error: 'Incorrect PIN' });

    const now = new Date();
    if (rep.valid_from  && now < new Date(rep.valid_from))  return res.status(403).json({ success: false, error: 'Sign-in is not open yet for this event' });
    if (rep.valid_until && now > new Date(rep.valid_until)) return res.status(403).json({ success: false, error: 'This event has ended' });

    // Bearer identity = the event_reps link; the displayed rep id is the real staff id.
    const authToken = signRep({ repId: rep.rep_link_id, eventId: rep.event_id, exp: Date.now() + TTL_MS });
    res.json({
      success: true,
      data: {
        authToken,
        rep: {
          id: rep.staff_id,
          fullName: rep.full_name,
          position: rep.position,
          institutionId: rep.institution_id,
          institutionName: rep.institution_name,
          eventId: rep.event_id,
          roving: rep.institution_id == null,
        },
      },
    });
  } catch (err) {
    console.error('[event-desk] login:', err);
    res.status(500).json({ success: false, error: 'Sign-in failed' });
  }
});

// ── GET /me ──────────────────────────────────────────────────
router.get('/me', requireRep, async (req, res) => {
  try {
    const sess = await pool.query(
      `SELECT ds.id, ds.institution_id, i.name AS institution_name, ds.started_at
         FROM desk_sessions ds LEFT JOIN institutions i ON i.id = ds.institution_id
        WHERE ds.staff_id = $1 AND ds.ended_at IS NULL
        ORDER BY ds.started_at DESC LIMIT 1`,
      [req.rep.id]
    );
    res.json({
      success: true,
      data: {
        rep: { id: req.rep.id, fullName: req.rep.full_name, institutionId: req.rep.institution_id, eventId: req.rep.event_id },
        deskSession: sess.rows[0]
          ? { id: sess.rows[0].id, institutionId: sess.rows[0].institution_id,
              institutionName: sess.rows[0].institution_name, startedAt: sess.rows[0].started_at }
          : null,
      },
    });
  } catch (err) {
    console.error('[event-desk] me:', err);
    res.status(500).json({ success: false, error: 'Failed to load session' });
  }
});

// ── GET /desks ── active desks for this rep's event (for roving pick) ─
router.get('/desks', requireRep, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ei.institution_id, i.name AS institution_name
         FROM event_institutions ei JOIN institutions i ON i.id = ei.institution_id
        WHERE ei.event_id = $1 AND ei.is_active = true
        ORDER BY i.name ASC`,
      [req.rep.event_id]
    );
    res.json({ success: true, data: r.rows.map(x => ({ institutionId: x.institution_id, institutionName: x.institution_name })) });
  } catch (err) {
    console.error('[event-desk] desks:', err);
    res.status(500).json({ success: false, error: 'Failed to load desks' });
  }
});

// ── POST /sign-in-desk ── open a desk_session (closes any prior open one) ─
router.post('/sign-in-desk', requireRep, async (req, res) => {
  const institutionId = req.body.institutionId ? parseInt(req.body.institutionId, 10) : req.rep.institution_id;
  if (!institutionId) return res.status(400).json({ success: false, error: 'Pick a desk to sign into' });

  try {
    const chk = await pool.query(
      `SELECT 1 FROM event_institutions
        WHERE event_id = $1 AND institution_id = $2 AND is_active = true LIMIT 1`,
      [req.rep.event_id, institutionId]
    );
    if (chk.rowCount === 0) return res.status(404).json({ success: false, error: 'No active desk for that institution at this event' });

    await pool.query(`UPDATE desk_sessions SET ended_at = NOW() WHERE staff_id = $1 AND ended_at IS NULL`, [req.rep.id]);
    const ins = await pool.query(
      `INSERT INTO desk_sessions (event_id, institution_id, staff_id)
       VALUES ($1, $2, $3) RETURNING id, started_at`,
      [req.rep.event_id, institutionId, req.rep.id]
    );
    res.json({ success: true, data: { sessionId: ins.rows[0].id, institutionId } });
  } catch (err) {
    console.error('[event-desk] sign-in-desk:', err);
    res.status(500).json({ success: false, error: 'Failed to sign into desk' });
  }
});

// ── POST /sign-out-desk ── close the open session ─────────────
router.post('/sign-out-desk', requireRep, async (req, res) => {
  try {
    await pool.query(`UPDATE desk_sessions SET ended_at = NOW() WHERE staff_id = $1 AND ended_at IS NULL`, [req.rep.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[event-desk] sign-out-desk:', err);
    res.status(500).json({ success: false, error: 'Failed to sign out' });
  }
});

// ── helpers for the desk note segment stamp ──────────────────
const _p2 = (n) => String(n).padStart(2, '0');
function stampLine(repName, institutionName) {
  const d = new Date();
  const ts = `${d.getFullYear()}-${_p2(d.getMonth() + 1)}-${_p2(d.getDate())} ${_p2(d.getHours())}:${_p2(d.getMinutes())}`;
  return `[${ts}] ${repName}${institutionName ? ' \u00b7 ' + institutionName : ''}`;
}

// ── POST /lookup ── resolve a scanned attendance token → student name +
// the currently-required qualification fields (admin-configurable), minus the
// contact identifiers. Display-only context for the booth operator; email,
// phone and Zalo (preferred_social) NEVER leave this endpoint.
const LOOKUP_EXCLUDE = ['email', 'phone', 'preferred_social'];
function _present(v) { return v !== null && v !== undefined && String(v).trim() !== ''; }

router.post('/lookup', requireRep, async (req, res) => {
  const code = (req.body.attendanceToken || req.body.code || '').trim();
  if (!code) return res.status(400).json({ success: false, error: 'Nothing scanned' });
  try {
    const r = await pool.query(
      `SELECT s.*
         FROM event_attendees ea
         JOIN students s ON s.student_id = ea.student_unique_id
        WHERE ea.attendance_token = $1 AND ea.event_id = $2
        LIMIT 1`,
      [code, req.rep.event_id]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Not recognised — is the student checked in?' });
    }
    const student = r.rows[0];

    // Currently-required fields, minus contact identifiers, in VIETNAMESE:
    // field labels prefer event_qualification_fields.label_vi (when the column
    // exists), and stored codes are translated via lookup_values.label_vi —
    // the same resolution the student-facing questionnaire uses. Read live so
    // toggling fields in the Qualification tab changes the scan automatically.
    const FIELD_LOOKUP_CATEGORY = { residency: 'vietnam_province', destination_country: 'country' };
    let profile = [];
    try {
      const hasQfVi = (await pool.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name='event_qualification_fields' AND column_name='label_vi' LIMIT 1`)).rowCount > 0;
      const labelExpr = hasQfVi ? `COALESCE(NULLIF(label_vi, ''), label)` : `label`;
      const qf = await pool.query(
        `SELECT field_key, ${labelExpr} AS label FROM event_qualification_fields
          WHERE is_required = true ORDER BY sort_order`
      );
      for (const f of qf.rows) {
        if (LOOKUP_EXCLUDE.includes(f.field_key) || !_present(student[f.field_key])) continue;
        const raw = String(student[f.field_key]).trim();
        let value = raw;
        try {
          const lv = await pool.query(
            `SELECT COALESCE(NULLIF(label_vi, ''), NULLIF(label_en, ''), code) AS label
               FROM lookup_values
              WHERE category = $1 AND code = $2 AND is_active = true
              LIMIT 1`,
            [FIELD_LOOKUP_CATEGORY[f.field_key] || f.field_key, raw]
          );
          if (lv.rowCount) value = lv.rows[0].label;
        } catch (_) { /* keep the raw value */ }
        profile.push({ label: f.label, value });
      }
    } catch (e) {
      console.error('[event-desk] lookup profile:', e.message);   // non-fatal
    }

    // Name + stone + required profile only — email/phone/Zalo never leave
    // this endpoint. The stone tier is fine to show reps: it's already
    // visible to them in the centre of the badge QR they just scanned.
    res.json({ success: true, data: {
      studentUniqueId: student.student_id,
      fullName: student.full_name,
      stoneTier: isStoneTier(student.stone_tier) ? student.stone_tier : '',
      profile,
    } });
  } catch (err) {
    console.error('[event-desk] lookup:', err);
    res.status(500).json({ success: false, error: 'Lookup failed' });
  }
});

// ── POST /visit ── append a stamped note segment under the event topic
// (consolidated per student) + write the structured event_desk_visits row.
router.post('/visit', requireRep, async (req, res) => {
  const studentUniqueId = (req.body.studentUniqueId || '').trim();
  const noteText        = (req.body.note || '').trim();
  let   repRating       = req.body.repRating != null && req.body.repRating !== '' ? parseInt(req.body.repRating, 10) : null;
  if (repRating != null && (isNaN(repRating) || repRating < 1 || repRating > 10)) repRating = null;

  if (!studentUniqueId) return res.status(400).json({ success: false, error: 'No student selected' });
  if (!noteText)        return res.status(400).json({ success: false, error: 'A note is required' });

  try {
    // 1. must have an OPEN desk session (gives us the institution).
    const sess = await pool.query(
      `SELECT ds.id, ds.institution_id, i.name AS institution_name
         FROM desk_sessions ds LEFT JOIN institutions i ON i.id = ds.institution_id
        WHERE ds.staff_id = $1 AND ds.ended_at IS NULL
        ORDER BY ds.started_at DESC LIMIT 1`,
      [req.rep.id]
    );
    if (sess.rowCount === 0) return res.status(409).json({ success: false, error: 'Sign into a desk first' });
    const desk = sess.rows[0];

    // 2. student must belong to this event.
    const att = await pool.query(
      `SELECT 1 FROM event_attendees WHERE event_id = $1 AND student_unique_id = $2 LIMIT 1`,
      [req.rep.event_id, studentUniqueId]
    );
    if (att.rowCount === 0) return res.status(404).json({ success: false, error: 'Student is not on this event' });

    // 3. topic = the event's name (e.g. "Fair First Date 18.7.2026").
    const ev = await pool.query(`SELECT name FROM events WHERE id = $1`, [req.rep.event_id]);
    const topic = ev.rows[0] ? ev.rows[0].name : `Event ${req.rep.event_id}`;

    // 3b. Attach to the student's lead so the note lives ONLY at the lead level
    // (LeadDetail reads lead-scoped notes). Prefer an OPEN lead; if none is open,
    // fall back to the most recent lead of any status so the note always lands on
    // a lead. leadId stays NULL only if the person has no lead at all.
    const leadPick = await pool.query(
      `SELECT lead_id FROM leads
        WHERE person_id = $1
        ORDER BY (CASE WHEN lead_status IN ('Contracted', 'Lost', 'Archived', 'Cancelled') THEN 1 ELSE 0 END),
                 lead_id DESC
        LIMIT 1`,
      [studentUniqueId]
    );
    const leadId = leadPick.rows[0] ? leadPick.rows[0].lead_id : null;

    // 4. build the immutable, stamped segment (rep + date/time + institution + rating).
    const ratingLine = repRating != null ? `\nEngagement: ${repRating}/10` : '';
    const segment = `${stampLine(req.rep.full_name, desk.institution_name)}\n${noteText}${ratingLine}`;


    // 5. consolidate: one note per (student, topic). Append a segment, else create.
    const existing = await pool.query(
      `SELECT id, lead_id FROM student_notes
        WHERE student_id = $1 AND topic = $2 AND note_type = 'counselor'
        ORDER BY created_at ASC LIMIT 1`,
      [studentUniqueId, topic]
    );

    let noteRow;
    if (existing.rowCount > 0) {
      noteRow = await StudentNote.appendNote(existing.rows[0].id, `\n\n${segment}`, null);
      // Backfill the lead link if this consolidated note predates the open lead.
      if (leadId && existing.rows[0].lead_id == null) {
        await pool.query(`UPDATE student_notes SET lead_id = $1 WHERE id = $2`, [leadId, existing.rows[0].id]);
      }
    } else {
      noteRow = await StudentNote.create({
        studentId: studentUniqueId,
        leadId,
        noteType: 'counselor',
        content: segment,
        authorId: req.rep.id,
        authorName: req.rep.full_name,
        topic,
      });
    }

    // 6. structured visit record (institution-level data + the rep's rating).
    await pool.query(
      `INSERT INTO event_desk_visits
         (event_id, institution_id, desk_session_id, student_unique_id, recorded_by, rep_rating, note_id, visited_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [req.rep.event_id, desk.institution_id, desk.id, studentUniqueId, req.rep.id, repRating, noteRow.id]
    );

    res.json({ success: true, data: { noteId: noteRow.id, institutionName: desk.institution_name } });
  } catch (err) {
    console.error('[event-desk] visit:', err);
    res.status(500).json({ success: false, error: 'Failed to save visit' });
  }
});

module.exports = router;
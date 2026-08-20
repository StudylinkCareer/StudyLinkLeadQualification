// server/src/controllers/staffController.js

const Staff = require('../models/Staff');
const { Pool } = require('pg');
const driveService = require('../services/driveService');
const { toSnakeCase, objectToCamelCase } = require('../utils/caseConvert');
const { logChanges } = require('./auditController');
const { assessOcean } = require('../utils/oceanCalculator');
const permissionService = require('../services/permissionService');
const { syncOrderPhase, phaseForPosition, isReportableStatus,
        slotsForPhase, allowedTransitions, isTransitionAllowed, recipientRequired } = require('../utils/orderPhase');
const { issueAdvanceTokens } = require('../services/eventQualification');

// Local pool — matches the pattern used elsewhere in this codebase.
// Used only by deleteStudents for the archive query + transactional delete.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Connected-unit rule (P3): a front-line phase must always have an active lead.
// When a Sales record is moved into a working phase and every one of its leads is
// terminal (Lost/Cancelled/Archived/Contracted — frozen history), we mint ONE new
// active lead so the record surfaces in that phase's reports. Pool is exempt (it's
// the record-level parking queue — a record can sit there with no active lead).
// The new lead inherits the order's current staff via Lead.create (so it lands on
// the recipient we just assigned). Returns the new leadId, or null if none needed.
// Runs AFTER the move commits — Lead.create manages its own connection.
async function ensureActiveLeadForPhase(dbPool, studentId, toPhase) {
  if (!toPhase || toPhase === 'Pool') return null;
  const { n } = (await dbPool.query(
    `SELECT COUNT(*)::int AS n FROM leads
      WHERE person_id = $1
        AND lead_status NOT IN ('Contracted','Lost','Archived','Cancelled')`,
    [studentId])).rows[0];
  if (n > 0) return null;                       // already has an active lead
  const Lead = require('../models/Lead');
  const created = await Lead.create(studentId, { leadStatus: 'New' });
  return created.leadId;
}

// Every table referencing a student, CHILD-FIRST, for a complete cleanse. Shared by
// the delete cascade, the delete-preview, and the orphan sweep. (duplicate_reviews is
// handled separately — its incoming_uid is a parked, not-yet-created person, so it
// needs OR-matched_ids logic on delete and is NOT an orphan source.)
const STUDENT_CHILD_TABLES = [
  { table: 'event_desk_visits', key: 'student_unique_id', label: 'eventDeskVisits' },
  { table: 'event_attendees',   key: 'student_unique_id', label: 'eventAttendees' },
  { table: 'lead_events',       key: 'student_id',        label: 'leadEvents' },
  { table: 'documents',         key: 'student_id',        label: 'documents' },
  { table: 'audit_log',         key: 'student_id',        label: 'auditLog' },
  { table: 'student_notes',     key: 'student_id',        label: 'notes' },
  { table: 'leads',             key: 'person_id',         label: 'leads' },
];

// ── Auth ──────────────────────────────────────────────────────
// Console access window: returns a rejection message if the account's OPTIONAL
// valid-from/valid-until window is closed right now, else null. Both NULL =
// unrestricted (only is_active gates access). Distinct from the event_reps desk
// window — this gates LM-console login + session.
function accessWindowRejection(row) {
  const now = Date.now();
  const from  = row.access_valid_from  ? new Date(row.access_valid_from).getTime()  : null;
  const until = row.access_valid_until ? new Date(row.access_valid_until).getTime() : null;
  if (from  && now < from)  return 'Your access to StudyLink has not started yet.';
  if (until && now > until) return 'Your access to StudyLink has ended.';
  return null;
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }
    const staff = await Staff.findByEmail(email);
    if (staff && !staff.is_active) {
      return res.status(401).json({ success: false, error: 'This account has been deactivated. Contact an administrator.' });
    }
    if (!staff) {
      return res.status(401).json({ success: false, error: 'Incorrect email or password.' });
    }
    const valid = await Staff.verifyPassword(staff, password);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Incorrect email or password.' });
    }
    // Optional access window (blank = unrestricted; only is_active gates).
    const windowErr = accessWindowRejection(staff);
    if (windowErr) return res.status(401).json({ success: false, error: windowErr });
    req.session.staffId       = staff.id;
    req.session.staffEmail    = staff.email;
    // Permission key = the authorisation PROFILE, which after the profile
    // migration is stored in staff.position. If that position is a seeded
    // profile use it; otherwise fall back to the legacy role (un-migrated staff
    // / rollback). staffTier keeps the coarse tier (Executive/Manager/Staff/Tech).
    // profileExists reads a cached snapshot — if it says "not a profile", refresh
    // the cache from the DB and re-check, so a login right after a seed doesn't
    // wrongly fall back to the (permission-less) tier.
    let usePosition = staff.position && await permissionService.profileExists(staff.position);
    if (!usePosition && staff.position) {
      permissionService.clearCache();
      usePosition = await permissionService.profileExists(staff.position);
    }
    req.session.staffRole     = usePosition ? staff.position : staff.role;
    req.session.staffTier     = staff.role;
    req.session.staffName     = staff.full_name;
    req.session.staffPosition = staff.position;
    res.json({
      success: true,
      staff: {
        id:       staff.id,
        fullName: staff.full_name,
        email:    staff.email,
        position: staff.position,
        role:     staff.role,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res) {
  req.session.destroy(() => {
    res.json({ success: true });
  });
}

async function checkSession(req, res) {
  if (req.session && req.session.staffId) {
    // Re-validate on every reconcile: a mid-session deactivation or an expired
    // access window ends the session (the frontend re-checks on mount/focus).
    try {
      const r = await pool.query(
        'SELECT is_active, access_valid_from, access_valid_until FROM staff WHERE id = $1',
        [req.session.staffId]
      );
      const row = r.rows[0];
      if (!row || row.is_active === false || accessWindowRejection(row)) {
        return req.session.destroy(() => res.json({ success: true, authenticated: false }));
      }
    } catch (_) { /* DB blip — keep the current session rather than lock out */ }
    return res.json({
      success:       true,
      authenticated: true,
      staff: {
        id:       req.session.staffId,
        fullName: req.session.staffName,
        email:    req.session.staffEmail,
        position: req.session.staffPosition,
        role:     req.session.staffRole,
      },
    });
  }
  res.json({ success: true, authenticated: false });
}

// ── Staff Management ──────────────────────────────────────────
async function listStaff(req, res, next) {
  try {
    const staff = await Staff.findAll();
    res.json({ success: true, data: staff });
  } catch (err) { next(err); }
}

// Returns the distinct list of role names configured in role_permissions.
async function listRoles(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT DISTINCT role FROM role_permissions ORDER BY role`
    );
    res.json({ success: true, data: result.rows.map(r => r.role) });
  } catch (err) { next(err); }
}

// Returns the full field catalog with column metadata for the Leads list.
async function listColumns(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT field_name, label, column_width, column_order, category
       FROM permission_fields
       WHERE column_width IS NOT NULL
       ORDER BY column_order ASC, field_name ASC`
    );
    res.json({
      success: true,
      data: result.rows.map(r => ({
        fieldName: r.field_name,
        label:     r.label,
        width:     r.column_width,
        order:     r.column_order,
        category:  r.category,
      })),
    });
  } catch (err) { next(err); }
}

async function listActiveStaff(req, res, next) {
  try {
    const staff = await Staff.findAllActive();
    res.json({ success: true, data: staff });
  } catch (err) { next(err); }
}

// ── User Layout Variants ─────────────────────────────────────
async function listVariants(req, res, next) {
  try {
    const page = req.query.page || 'leads';
    const r = await pool.query(
      `SELECT id, name, config, is_default, created_at, updated_at
       FROM user_variants
       WHERE staff_id = $1 AND page = $2
       ORDER BY name`,
      [req.session.staffId, page]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { next(err); }
}

async function createVariant(req, res, next) {
  const client = await pool.connect();
  try {
    const { page, name, config, is_default } = req.body;
    if (!page || !name || !config) return res.status(400).json({ success: false, error: 'page, name, config required' });
    await client.query('BEGIN');
    if (is_default) {
      await client.query(
        `UPDATE user_variants SET is_default = FALSE WHERE staff_id = $1 AND page = $2`,
        [req.session.staffId, page]
      );
    }
    const r = await client.query(
      `INSERT INTO user_variants (staff_id, page, name, config, is_default)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, config, is_default, created_at, updated_at`,
      [req.session.staffId, page, name, config, !!is_default]
    );
    await client.query('COMMIT');
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ success: false, error: 'A variant with this name already exists' });
    next(err);
  } finally {
    client.release();
  }
}

async function updateVariant(req, res, next) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { name, config, is_default } = req.body;
    await client.query('BEGIN');
    if (is_default === true) {
      const pg = await client.query(
        `SELECT page FROM user_variants WHERE id = $1 AND staff_id = $2`,
        [id, req.session.staffId]
      );
      if (pg.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Variant not found' });
      }
      await client.query(
        `UPDATE user_variants SET is_default = FALSE WHERE staff_id = $1 AND page = $2 AND id <> $3`,
        [req.session.staffId, pg.rows[0].page, id]
      );
    }
    const r = await client.query(
      `UPDATE user_variants
       SET name       = COALESCE($1, name),
           config     = CASE WHEN $2::jsonb IS NULL THEN config ELSE config || $2::jsonb END,
           is_default = COALESCE($3, is_default),
           updated_at = NOW()
       WHERE id = $4 AND staff_id = $5
       RETURNING id, name, config, is_default, created_at, updated_at`,
      [name || null, config ? JSON.stringify(config) : null, typeof is_default === 'boolean' ? is_default : null, id, req.session.staffId]
    );
    if (r.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Variant not found' });
    }
    await client.query('COMMIT');
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ success: false, error: 'A variant with this name already exists' });
    next(err);
  } finally {
    client.release();
  }
}

async function deleteVariant(req, res, next) {
  try {
    const { id } = req.params;
    const r = await pool.query(
      `DELETE FROM user_variants WHERE id = $1 AND staff_id = $2`,
      [id, req.session.staffId]
    );
    if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'Variant not found' });
    res.json({ success: true });
  } catch (err) { next(err); }
}

async function getMe(req, res, next) {
  try {
    if (!req.session || !req.session.staffId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const staff = await Staff.findById(req.session.staffId);
    if (!staff) {
      return res.status(404).json({ success: false, error: 'Staff record not found' });
    }
    res.json({ success: true, data: staff });
  } catch (err) { next(err); }
}

async function createStaff(req, res, next) {
  try {
    const {
      fullName, email, position, role, password,
      emailClient, contactMobile, platformSms, platformZalo, platformWhatsapp,
      zaloNumber, zaloQrCode, whatsappQrCode, messengerUsername, messengerQrCode,
      accessValidFrom, accessValidUntil,
    } = req.body;
    if (!fullName || !email || !position || !role || !password) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }
    const staff = await Staff.create({
      fullName, email, position, role, password,
      emailClient, contactMobile, platformSms, platformZalo, platformWhatsapp,
      zaloNumber, zaloQrCode, whatsappQrCode, messengerUsername, messengerQrCode,
      accessValidFrom: accessValidFrom || null, accessValidUntil: accessValidUntil || null,
    });
    res.status(201).json({ success: true, data: staff });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'Email already exists' });
    }
    next(err);
  }
}

async function updateStaff(req, res, next) {
  try {
    const { id } = req.params;
    const {
      fullName, email, position, role, isActive, viewThreshold,
      emailClient, contactMobile, platformSms, platformZalo, platformWhatsapp,
      zaloNumber, zaloQrCode, whatsappQrCode, messengerUsername, messengerQrCode,
      lqSelectable, accessValidFrom, accessValidUntil,
    } = req.body;
    const staff = await Staff.update(id, {
      fullName, email, position, role, isActive, viewThreshold,
      emailClient, contactMobile, platformSms, platformZalo, platformWhatsapp,
      zaloNumber, zaloQrCode, whatsappQrCode, messengerUsername, messengerQrCode,
      lqSelectable,
      // Passed straight through (may be null to clear). Only reaches here from
      // the Staff edit form, which always sends both.
      accessValidFrom:  accessValidFrom  ?? null,
      accessValidUntil: accessValidUntil ?? null,
    });
    if (!staff) return res.status(404).json({ success: false, error: 'Staff member not found' });
    res.json({ success: true, data: staff });
  } catch (err) { next(err); }
}

async function resetPassword(req, res, next) {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }
    await Staff.updatePassword(id, password);
    res.json({ success: true, message: 'Password updated' });
  } catch (err) { next(err); }
}

async function deactivateStaff(req, res, next) {
  try {
    const { id } = req.params;
    const staff = await Staff.deactivate(id);
    if (!staff) return res.status(404).json({ success: false, error: 'Staff member not found' });
    res.json({ success: true, data: staff });
  } catch (err) { next(err); }
}

async function setTarget(req, res, next) {
  try {
    const { id } = req.params;
    const { target } = req.body;
    if (target === undefined || isNaN(target)) {
      return res.status(400).json({ success: false, error: 'Target must be a number' });
    }
    const staff = await Staff.setTarget(id, Number(target), req.session.staffName);
    if (!staff) return res.status(404).json({ success: false, error: 'Staff member not found' });
    res.json({ success: true, data: staff });
  } catch (err) { next(err); }
}

async function setCallTarget(req, res, next) {
  try {
    const { id } = req.params;
    const { target } = req.body;
    if (target === undefined || isNaN(target)) {
      return res.status(400).json({ success: false, error: 'Target must be a number' });
    }
    const staff = await Staff.setCallTarget(id, Number(target), req.session.staffName);
    if (!staff) return res.status(404).json({ success: false, error: 'Staff member not found' });
    res.json({ success: true, data: staff });
  } catch (err) { next(err); }
}

// ── Student Assignments ───────────────────────────────────────
async function assignStaff(req, res, next) {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    const { studentId } = req.params;
    const { counselor, seniorCounselor, presales, marketingStaff } = req.body;

    const assignStaffCtx = {
      role: req.session.staffRole,
      fullName: req.session.staffName,
    };
    // Order-driven: assignment is set on the Sales Order (students.* = canonical
    // owner) and CASCADES only to the person's IN-PROGRESS leads. CLOSED leads
    // RETAIN their staff — that's Lost/Archived/Cancelled AND Contracted (a WON
    // lead keeps the counsellor who closed it, even if the order is later
    // transferred). Note: Contracted is still EDITABLE (only its staff is frozen).
    const OPEN = `lead_status NOT IN ('Contracted','Lost','Archived','Cancelled')`;
    const beforeRows = (await pool.query(
      `SELECT lead_id, counselor, senior_counselor, presales, marketing_staff
         FROM leads WHERE person_id = $1 AND ${OPEN}
        ORDER BY lead_id`, [studentId]
    )).rows;

    // Permission: via an active lead if there is one, else via the person/order.
    const canAssign = await permissionService.canAccessLead(
      assignStaffCtx, beforeRows.length ? objectToCamelCase(beforeRows[0]) : { studentId }, 'assign'
    );
    if (!canAssign) {
      await pool.end();
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to reassign this Sales Order.',
      });
    }

    // Current owner BEFORE the change — lets us tell a genuine transfer
    // (counsellor actually changing) from a no-op save, so we only mint on a
    // real transfer of an order that has no active lead.
    const prevCounselor = ((await pool.query(
      `SELECT counselor FROM students WHERE student_id = $1`, [studentId]
    )).rows[0] || {}).counselor || null;

    // 1) Canonical owner on the Sales Order.
    await pool.query(
      `UPDATE students
          SET counselor        = COALESCE($1, counselor),
              senior_counselor = COALESCE($2, senior_counselor),
              presales         = COALESCE($3, presales),
              marketing_staff  = COALESCE($4, marketing_staff),
              updated_at       = NOW()
        WHERE student_id = $5`,
      [counselor, seniorCounselor, presales, marketingStaff, studentId]
    );

    // 2) Cascade to ACTIVE leads (locked leads keep their existing staff).
    const result = await pool.query(
      `UPDATE leads
          SET counselor        = COALESCE($1, counselor),
              senior_counselor = COALESCE($2, senior_counselor),
              presales         = COALESCE($3, presales),
              marketing_staff  = COALESCE($4, marketing_staff),
              updated_at       = NOW()
        WHERE person_id = $5 AND ${OPEN}
        RETURNING lead_id, counselor, senior_counselor, presales, marketing_staff`,
      [counselor, seniorCounselor, presales, marketingStaff, studentId]
    );

    // Lead-keyed audit: record who/when per cascaded lead.
    const changedBy = req.session.staffName || req.session.staffEmail || 'unknown';
    const beforeById = new Map(beforeRows.map(r => [r.lead_id, objectToCamelCase(r)]));
    for (const row of result.rows) {
      const after  = objectToCamelCase(row);
      const before = beforeById.get(row.lead_id) || {};
      await logChanges({
        studentId,
        leadId: row.lead_id,
        changedBy,
        oldData: before,
        newData: {
          counselor:       after.counselor,
          seniorCounselor: after.seniorCounselor,
          presales:        after.presales,
          marketingStaff:  after.marketingStaff,
        },
        source: 'staff_app',
      });
    }

    // Transfer of an order with NO active lead: mint a fresh ACTIVE lead so the
    // new counsellor has something to work. It seeds staff from the (just-updated)
    // order and carries the prior lead's profile (destination, study plans,
    // institution, etc.). Created as 'New' (active), so any later transfer just
    // cascades to it above — no duplicate minting (rule #3).
    const newCounselor = counselor != null ? counselor : prevCounselor;
    if (result.rows.length === 0 && newCounselor && newCounselor !== prevCounselor) {
      const Lead = require('../models/Lead');
      const minted = await Lead.create(studentId, { leadStatus: 'New' });
      await logChanges({
        studentId,
        leadId: minted.leadId,
        changedBy,
        oldData: {},
        newData: { leadStatus: 'New', counselor: minted.counselor },
        source: 'staff_app',
      });
    }

    // Explicit-phase model: the Order's phase is set by changePhase/massMovePhase,
    // NOT re-derived here. Re-deriving from the counselor would revert an Order that
    // was deliberately moved to another phase (its counselor is retained history).

    // Return the order's canonical staff so the person view reflects it.
    const ordRow = (await pool.query(
      `SELECT counselor, senior_counselor, presales, marketing_staff
         FROM students WHERE student_id = $1`, [studentId]
    )).rows[0] || {};
    await pool.end();
    res.json({ success: true, data: objectToCamelCase(ordRow) });
  } catch (err) { next(err); }
}

// ── Phase-driven move: PUT /api/staff/phase/:studentId ─────────────────────
// Body: { toPhase, staffName? }. The AUTHORITATIVE way an Order changes phase:
//   1. validate the move against phase_transitions (admin control table)
//   2. set students.order_phase
//   3. optionally set the new phase's active position's owner (order_assignments,
//      mirrored to the legacy students column when one exists)
//   4. cascade mirrored positions to the Order's ACTIVE leads (closed retain)
// Assumes ONE primary active position per phase for the owner being set (uses
// the first active position). Restricted to roles with 'assign' permission.
async function changePhase(req, res, next) {
  const OrderAssignment = require('../models/OrderAssignment');
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  try {
    const { studentId } = req.params;
    const { toPhase, staffName, position: reqPosition } = req.body || {};
    if (!toPhase) { await pool.end(); return res.status(400).json({ success: false, error: 'toPhase is required' }); }

    const ctx = { role: req.session.staffRole, fullName: req.session.staffName };
    const canAssign = await permissionService.canAccessLead(ctx, { studentId }, 'assign');
    if (!canAssign) {
      await pool.end();
      return res.status(403).json({ success: false, error: 'You do not have permission to move this Sales Order.' });
    }

    const cur = (await pool.query(
      `SELECT order_phase FROM students WHERE student_id = $1`, [studentId])).rows[0];
    if (!cur) { await pool.end(); return res.status(404).json({ success: false, error: 'Sales Order not found' }); }
    const fromPhase = cur.order_phase || 'Pool';

    // Validate the move against the canonical transition map (code-driven).
    if (!isTransitionAllowed(fromPhase, toPhase)) {
      await pool.end();
      return res.status(400).json({ success: false, error: `"${fromPhase}" cannot move to "${toPhase}". Allowed: ${allowedTransitions(fromPhase).join(', ') || '(none)'}.` });
    }
    // Resolve the target slot: single-slot phases auto-pick; multi-slot honour the
    // caller's choice (Pool → Quality/Tech Support, Case Officers → Direct/Sub).
    const slots = slotsForPhase(toPhase);
    if (reqPosition && !slots.includes(reqPosition)) {
      await pool.end();
      return res.status(400).json({ success: false, error: `"${reqPosition}" is not a valid position for "${toPhase}". Options: ${slots.join(', ') || '(none)'}.` });
    }
    const position = (reqPosition && slots.includes(reqPosition)) ? reqPosition : (slots[0] || null);
    // Mandatory recipient for front-line phases (Counselling / Pre-Sales / Case Officers).
    if (recipientRequired(toPhase) && !(staffName && String(staffName).trim())) {
      await pool.end();
      return res.status(400).json({ success: false, error: `A recipient is required to move into "${toPhase}".` });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Explicit-phase: set order_phase, assign ONLY the chosen position. Every OTHER
      // slot keeps its retained staff (greyed history). Do NOT touch students.counselor
      // and do NOT syncOrderPhase (either would revert the move).
      await client.query(
        `UPDATE students SET order_phase = $1, updated_at = NOW() WHERE student_id = $2`,
        [toPhase, studentId]);
      if (position && staffName !== undefined) {
        await OrderAssignment.setForOrder(client, studentId, position, staffName);
        const col = OrderAssignment.POSITION_COLUMN[position];
        if (col) {
          await client.query(
            `UPDATE students SET ${col} = $1, updated_at = NOW() WHERE student_id = $2`,
            [staffName || '', studentId]);
          // Connected-unit model: the recipient cascades to the record's ACTIVE
          // leads only. Inactive/terminal leads FREEZE the owner they had when
          // they closed (that's their history — who won/lost it) and never take
          // on a later phase's owner. A record whose leads are all inactive has
          // by then been auto-moved to Pool, so nothing is orphaned.
          await client.query(
            `UPDATE leads SET ${col} = $1, updated_at = NOW()
              WHERE person_id = $2 AND lead_status NOT IN ('Contracted','Lost','Archived','Cancelled')`,
            [staffName || '', studentId]);
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK'); client.release(); await pool.end();
      throw e;
    }
    client.release();

    await logChanges({
      studentId, leadId: null,
      changedBy: req.session.staffName || req.session.staffEmail || 'unknown',
      oldData: { orderPhase: fromPhase },
      newData: { orderPhase: toPhase, ...(staffName !== undefined ? { staffName } : {}) },
      source: 'staff_app',
    });

    // P3: if the record has no active lead after moving into a working phase,
    // mint one so it surfaces in that phase's active reports.
    const createdLeadId = await ensureActiveLeadForPhase(pool, studentId, toPhase);

    const assignments = await OrderAssignment.getForOrder(studentId, pool);
    await pool.end();
    // Code-driven: onward phases + the target phase's slots (positions).
    res.json({ success: true, data: {
      orderPhase: toPhase, assignments,
      nextPhases: allowedTransitions(toPhase),
      editablePositions: slotsForPhase(toPhase),
      createdLeadId,
    } });
  } catch (err) { next(err); }
}

// Set ONE position's owner on the Sales Order (order_assignments), for positions
// that have no legacy column (Quality, Tech Support, Case Officer…) as well as
// the legacy four. When a legacy column exists it is mirrored on students +
// cascaded to ACTIVE leads so existing reporting keeps working. Does NOT change
// the phase — that's changePhase. Powers the extended Staff Assignment window.
async function setAssignment(req, res, next) {
  const OrderAssignment = require('../models/OrderAssignment');
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  try {
    const { studentId } = req.params;
    const { position, staffName } = req.body || {};
    if (!position) { await pool.end(); return res.status(400).json({ success: false, error: 'position is required' }); }

    const ctx = { role: req.session.staffRole, fullName: req.session.staffName };
    const canAssign = await permissionService.canAccessLead(ctx, { studentId }, 'assign');
    if (!canAssign) {
      await pool.end();
      return res.status(403).json({ success: false, error: 'You do not have permission to reassign this Sales Order.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await OrderAssignment.setForOrder(client, studentId, position, staffName);
      const col = OrderAssignment.POSITION_COLUMN[position];
      if (col) {
        await client.query(
          `UPDATE students SET ${col} = $1, updated_at = NOW() WHERE student_id = $2`,
          [staffName || '', studentId]);
        // Connected-unit model: cascade to ACTIVE leads only; inactive/terminal
        // leads freeze their historical owner. Other positions' retained staff
        // are untouched (only this column is written).
        await client.query(
          `UPDATE leads SET ${col} = $1, updated_at = NOW()
            WHERE person_id = $2 AND lead_status NOT IN ('Contracted','Lost','Archived','Cancelled')`,
          [staffName || '', studentId]);
        // Explicit-phase model: do NOT re-derive order_phase here (would revert a
        // deliberately-moved Order). Phase is owned by changePhase/massMovePhase.
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK'); client.release(); await pool.end();
      throw e;
    }
    client.release();

    await logChanges({
      studentId, leadId: null,
      changedBy: req.session.staffName || req.session.staffEmail || 'unknown',
      oldData: {}, newData: { position, staffName: staffName || '' },
      source: 'staff_app',
    });

    const assignments = await OrderAssignment.getForOrder(studentId, pool);
    await pool.end();
    res.json({ success: true, data: { assignments } });
  } catch (err) { next(err); }
}

async function massAssign(req, res, next) {
  try {
    const massAssignScope = await permissionService.getResourceScope(
      req.session.staffRole, 'leads', 'assign'
    );
    if (massAssignScope !== 'all') {
      return res.status(403).json({
        success: false,
        error: 'Mass-assign requires unrestricted assign permission. Use single-assign for individual leads.',
      });
    }

    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    const { studentIds, field, value } = req.body;
    const allowedFields = ['counselor', 'seniorCounselor', 'presales', 'marketingStaff'];
    if (!allowedFields.includes(field)) {
      return res.status(400).json({ success: false, error: 'Invalid assignment field' });
    }
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, error: 'studentIds array is required' });
    }
    const dbField = toSnakeCase(field);
    // Cascade only to genuinely in-progress leads; closed leads (incl. Cancelled
    // and Contracted) retain their staff — same rule as the 1-off assign.
    const OPEN = `lead_status NOT IN ('Contracted','Lost','Archived','Cancelled')`;

    // ── Guardrail: respect the approved phase routes ──────────────────────
    // Only the counselor slot drives the Order phase, so a phase move can only
    // happen on a counselor mass-assign. Target phase = the department of the
    // assignee's position (blank = Pool). Any selected Order whose current phase
    // cannot legally transition to the target is a CONFLICT — and per the rule we
    // block the WHOLE batch (nothing applied) and explain, so the user fixes the
    // selection rather than silently moving Orders along un-approved routes.
    if (field === 'counselor') {
      const OrderAssignment = require('../models/OrderAssignment');
      let targetPhase = 'Pool';
      if (value) {
        const posRow = (await pool.query(
          `SELECT position FROM staff WHERE full_name = $1 AND COALESCE(role,'') <> 'Event staff' LIMIT 1`, [value])).rows[0];
        targetPhase = phaseForPosition(posRow ? posRow.position : null);
      }
      const cur = (await pool.query(
        `SELECT student_id, COALESCE(order_phase, 'Pool') AS phase
           FROM students WHERE student_id = ANY($1)`, [studentIds])).rows;
      const conflicts = [];
      for (const r of cur) {
        if (r.phase === targetPhase) continue;   // reassign within the same phase — allowed
        if (!(await OrderAssignment.isTransitionAllowed(r.phase, targetPhase, pool))) {
          conflicts.push({ studentId: r.student_id, from: r.phase, to: targetPhase });
        }
      }
      if (conflicts.length) {
        await pool.end();
        const shown = conflicts.slice(0, 8).map(c => `${c.studentId} (${c.from}→${c.to})`).join(', ');
        return res.status(409).json({
          success: false,
          error: `Blocked — ${conflicts.length} of ${studentIds.length} order(s) cannot move to "${targetPhase}": not an approved route. ${shown}${conflicts.length > 8 ? ` …and ${conflicts.length - 8} more` : ''}. Deselect these (or move them via Pool) and retry.`,
          conflicts,
        });
      }
    }

    // Mass-assign applies to each selected student's OPEN leads (grouped by student).
    // Snapshot old values per open lead so we can audit who/when per lead.
    const before = await pool.query(
      `SELECT lead_id, person_id, ${dbField} AS old_val FROM leads
        WHERE person_id = ANY($1) AND ${OPEN}`,
      [studentIds]
    );

    // Order-driven: set the canonical owner on the Sales Order itself first...
    await pool.query(
      `UPDATE students SET ${dbField} = $1, updated_at = NOW()
        WHERE student_id = ANY($2)`,
      [value, studentIds]
    );
    // ...then cascade to each order's ACTIVE leads (closed leads keep their staff).
    await pool.query(
      `UPDATE leads SET ${dbField} = $1, updated_at = NOW()
        WHERE person_id = ANY($2) AND ${OPEN}`,
      [value, studentIds]
    );
    // Phase follows the (possibly new) owner on every affected Order.
    for (const sid of studentIds) await syncOrderPhase(pool, sid);
    await pool.end();

    // Lead-keyed audit for the leads whose value actually changed.
    const changedBy = req.session.staffName || req.session.staffEmail || 'unknown';
    const newVal = value === '' || value === null || value === undefined ? '' : value;
    for (const row of before.rows) {
      if (String(row.old_val ?? '') === String(newVal ?? '')) continue;
      await logChanges({
        studentId: row.person_id,
        leadId: row.lead_id,
        changedBy,
        oldData: { [field]: row.old_val },
        newData: { [field]: newVal },
        source: 'staff_app',
      });
    }

    res.json({ success: true, updated: studentIds.length });
  } catch (err) { next(err); }
}

// ── Bulk PHASE MOVE ───────────────────────────────────────────
// Move selected Orders to a target phase by setting the primary owner (the
// `counselor` slot drives the phase via syncOrderPhase — Model consistent with
// reinstate + reporting). Validates every Order against the approved routes and
// BLOCKS the whole batch (nothing applied) with an explanation if any move is
// disallowed. Empty owner = vacate → Pool.
async function massMovePhase(req, res, next) {
  const { Pool } = require('pg');
  const OrderAssignment = require('../models/OrderAssignment');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  try {
    const scope = await permissionService.getResourceScope(req.session.staffRole, 'leads', 'assign');
    if (scope !== 'all') {
      await pool.end();
      return res.status(403).json({ success: false, error: 'Mass move requires unrestricted assign permission.' });
    }
    const { studentIds, toPhase, staffName, position: reqPosition } = req.body || {};
    if (!Array.isArray(studentIds) || !studentIds.length || !toPhase) {
      await pool.end();
      return res.status(400).json({ success: false, error: 'studentIds (array) and toPhase are required' });
    }
    const targetPhase = toPhase;   // explicit target, consistent with changePhase
    // Resolve the target slot (single-slot auto-picks; multi-slot honours the choice).
    const slots = slotsForPhase(targetPhase);
    if (reqPosition && !slots.includes(reqPosition)) {
      await pool.end();
      return res.status(400).json({ success: false, error: `"${reqPosition}" is not a valid position for "${targetPhase}". Options: ${slots.join(', ') || '(none)'}.` });
    }
    const position = (reqPosition && slots.includes(reqPosition)) ? reqPosition : (slots[0] || null);
    // Mandatory recipient for front-line phases (Counselling / Pre-Sales / Case Officers).
    if (recipientRequired(targetPhase) && !(staffName && String(staffName).trim())) {
      await pool.end();
      return res.status(400).json({ success: false, error: `A recipient is required to move into "${targetPhase}".` });
    }
    // Validate every selected Order's transition — block the whole batch on any conflict.
    const cur = (await pool.query(
      `SELECT student_id, COALESCE(order_phase, 'Pool') AS phase FROM students WHERE student_id = ANY($1)`,
      [studentIds])).rows;
    const conflicts = [];
    for (const r of cur) {
      if (r.phase === targetPhase) continue;
      if (!isTransitionAllowed(r.phase, targetPhase)) {
        conflicts.push({ studentId: r.student_id, from: r.phase });
      }
    }
    if (conflicts.length) {
      await pool.end();
      const shown = conflicts.slice(0, 8).map(c => `${c.studentId} (${c.from}→${targetPhase})`).join(', ');
      return res.status(409).json({
        success: false,
        error: `Blocked — ${conflicts.length} of ${studentIds.length} order(s) cannot move to "${targetPhase}": not an approved route. ${shown}${conflicts.length > 8 ? ` …and ${conflicts.length - 8} more` : ''}. Deselect these (or route via Pool) and retry.`,
        conflicts,
      });
    }
    // Apply per Order (explicit-phase, matches changePhase): set order_phase + assign
    // the target phase's active position; the counselor is NOT overwritten (kept as
    // retained history). Empty owner = vacate (slot set empty → "Unassigned").
    // Connected-unit model: the recipient cascades to ACTIVE leads only; inactive/
    // terminal leads freeze their historical owner.
    const OPEN = `lead_status NOT IN ('Contracted','Lost','Archived','Cancelled')`;
    const col = position ? OrderAssignment.POSITION_COLUMN[position] : null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const sid of studentIds) {
        await client.query(`UPDATE students SET order_phase = $1, updated_at = NOW() WHERE student_id = $2`, [targetPhase, sid]);
        if (position && staffName !== undefined) {
          await OrderAssignment.setForOrder(client, sid, position, staffName);
          if (col) {
            await client.query(`UPDATE students SET ${col} = $1, updated_at = NOW() WHERE student_id = $2`, [staffName || '', sid]);
            await client.query(`UPDATE leads SET ${col} = $1, updated_at = NOW() WHERE person_id = $2 AND ${OPEN}`, [staffName || '', sid]);
          }
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK'); client.release(); await pool.end(); throw e;
    }
    client.release();

    // P3: mint an active lead for any moved record that has none (working phases
    // only). Done post-commit, before the pool closes.
    const createdLeadIds = [];
    for (const sid of studentIds) {
      const id = await ensureActiveLeadForPhase(pool, sid, targetPhase);
      if (id) createdLeadIds.push(id);
    }
    await pool.end();

    const changedBy = req.session.staffName || req.session.staffEmail || 'unknown';
    for (const sid of studentIds) {
      await logChanges({ studentId: sid, leadId: null, changedBy, oldData: {}, newData: { orderPhase: targetPhase, staffName: staffName || '' }, source: 'staff_app' });
    }
    res.json({ success: true, data: { moved: studentIds.length, toPhase: targetPhase, createdLeads: createdLeadIds.length } });
  } catch (err) { next(err); }
}

// ── Admin maintenance: stale-reminder review + close ──────────
// Admin or Tech Support only. The trigger auto-closes reminders on a Lead's
// status change; this is the manual review tool: LIST open reminders on Leads in
// the defined statuses, then close the SELECTED ones.
const STALE_STATUSES = ['Contracted', 'Lost', 'Archived', 'Not contactable'];

function maintenanceAllowed(req) {
  const { isAdminProfile } = require('../utils/authProfiles');
  return isAdminProfile(req.session.staffRole) || isAdminProfile(req.session.staffPosition)
      || req.session.staffPosition === 'Tech Support';
}

// GET — list open reminders whose Lead is in a stale status (optional ?status=).
async function listStaleReminders(req, res, next) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  try {
    if (!maintenanceAllowed(req)) { await pool.end(); return res.status(403).json({ success: false, error: 'Admin or Tech Support only.' }); }
    const status = STALE_STATUSES.includes(req.query.status) ? [req.query.status] : STALE_STATUSES;
    const rows = (await pool.query(
      `SELECT sn.id AS reminder_id, sn.lead_id, sn.student_id, s.full_name AS student_name,
              l.lead_status, sn.follow_up_date, sn.rescheduled_date, sn.topic, sn.content, sn.author_name
         FROM student_notes sn
         JOIN leads l    ON l.lead_id    = sn.lead_id
         JOIN students s ON s.student_id = sn.student_id
        WHERE sn.follow_up_date IS NOT NULL
          AND COALESCE(sn.reminder_status, '') <> 'closed'
          AND l.lead_status = ANY($1)
        ORDER BY l.lead_status, s.full_name, sn.follow_up_date`, [status])).rows;
    await pool.end();
    res.json({ success: true, data: rows.map(objectToCamelCase) });
  } catch (err) { next(err); }
}

// POST {reminderIds:[...]} — close the selected reminders.
async function closeReminders(req, res, next) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  try {
    if (!maintenanceAllowed(req)) { await pool.end(); return res.status(403).json({ success: false, error: 'Admin or Tech Support only.' }); }
    const { reminderIds } = req.body || {};
    if (!Array.isArray(reminderIds) || reminderIds.length === 0) { await pool.end(); return res.status(400).json({ success: false, error: 'reminderIds (array) is required' }); }
    const r = await pool.query(
      `UPDATE student_notes SET reminder_status = 'closed'
        WHERE id = ANY($1) AND COALESCE(reminder_status, '') <> 'closed'`, [reminderIds]);
    await pool.end();
    res.json({ success: true, data: { closed: r.rowCount } });
  } catch (err) { next(err); }
}

// ── Student Search ────────────────────────────────────────────
async function searchStudents(req, res, next) {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    const { q } = req.query;
    // Engagement (status/counsellor/etc.) lives on leads now; overlay the student's
    // representative lead (prefer an open one) so the list shows source-of-truth
    // values. The lateral l.* wins over the (vestigial / soon-dropped) s.* columns.
    const OVERLAY = `
      SELECT s.*, l.*
        FROM students s
        LEFT JOIN LATERAL (
          SELECT counselor, senior_counselor, presales, marketing_staff, lead_status, close_date,
                 confidence, distribution_status, office, prev_counselor, destination_country,
                 timeline, study_plans, process_application, major
            FROM leads WHERE person_id = s.student_id
           ORDER BY (lead_status NOT IN ('Contracted','Lost','Archived')) DESC, lead_id DESC
           LIMIT 1
        ) l ON true`;
    let query, params;
    if (!q || q.trim() === '') {
      query  = `${OVERLAY} ORDER BY s.created_at DESC NULLS LAST`;
      params = [];
    } else {
      const search = '%' + q.replace(/\*/g, '%').toLowerCase() + '%';
      query = `${OVERLAY}
        WHERE LOWER(s.full_name) LIKE $1
           OR LOWER(s.email)     LIKE $1
           OR s.phone            LIKE $1
        ORDER BY s.created_at DESC NULLS LAST`;
      params = [search];
    }
    const result = await pool.query(query, params);
    await pool.end();

    const staff = {
      role:     req.session.staffRole,
      fullName: req.session.staffName,
    };

    const scope = await permissionService.getResourceScope(
      staff.role, 'leads', 'view_list'
    );
    if (scope === 'none') {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to view leads.',
      });
    }

    let leads = result.rows.map(objectToCamelCase);

    if (scope === 'own') {
      leads = leads.filter(l => permissionService.isLeadAssignedTo(staff, l));
    }

    const masked = await permissionService.applyFieldPermissionsToList(staff, leads);

    res.json({ success: true, data: masked });
  } catch (err) { next(err); }
}

// Lead-level list — ONE ROW PER LEAD (engagement) joined to its person, in the same
// shape as searchStudents so the PROD Leads.jsx renders it unchanged. l.* wins over
// the vestigial s.* engagement; each row carries leadId + studentId.
async function searchLeads(req, res, next) {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    const { q } = req.query;
    // s.*, l.* → on duplicate columns (created_at/updated_at/assigned_in/out) the
    // LEAD's value wins (l.* is last). Person-level dates are aliased so the Leads
    // list can show BOTH levels side by side ("Lead ⋯" vs "Sales ⋯").
    // DATE columns are emitted via to_char('YYYY-MM-DD') so they serialise as plain
    // date strings — otherwise pg returns them as local-midnight Date objects that
    // toISOString() shifts back a day (breaking month math + showing dates a day early).
    // pool_owner = who actually holds a POOL-phase order: the Pool slot
    // (order_assignments Quality/Tech Support) if that slot exists, else the
    // counselor (migrated orders where the custodian sits in the primary slot).
    // An explicitly vacated slot ('') → NULL → shows as "Unassigned" in reporting.
    const base = `SELECT s.*, l.*,
        to_char(l.assigned_in,  'YYYY-MM-DD') AS assigned_in,
        to_char(l.assigned_out, 'YYYY-MM-DD') AS assigned_out,
        to_char(s.created_at,   'YYYY-MM-DD') AS person_created_at,
        to_char(s.updated_at,   'YYYY-MM-DD') AS person_updated_at,
        to_char(s.assigned_in,  'YYYY-MM-DD') AS person_assigned_in,
        to_char(s.assigned_out, 'YYYY-MM-DD') AS person_assigned_out,
        -- phase_owner = who currently OWNS the order in its CURRENT phase, for per-owner
        -- reporting. For phases that HAVE a maintained legacy column (Counselling→counselor,
        -- Presales→presales, Marketing→marketing_staff), that column is the source of truth —
        -- the order_assignments slot is a redundant mirror that can drift (empty, or a stale/
        -- wrong name), so we read the COLUMN first and only fall back to the slot if the
        -- column is blank. Pool / BD / Case Officers have NO legacy column, so the reconciled
        -- order_assignments slot is authoritative there (empty slot = "Unassigned").
        CASE
          WHEN s.order_phase = 'Counselling' THEN COALESCE(NULLIF(s.counselor,''),        po.owner)
          WHEN s.order_phase = 'Presales'    THEN COALESCE(NULLIF(s.presales,''),         po.owner, NULLIF(s.counselor,''))
          WHEN s.order_phase = 'Marketing'   THEN COALESCE(NULLIF(s.marketing_staff,''),  po.owner, NULLIF(s.counselor,''))
          WHEN po.has_slot                   THEN po.owner
          ELSE NULLIF(s.counselor,'')
        END AS phase_owner,
        -- Positions that have NO legacy column (they live only in order_assignments):
        -- surface each for the Leads list so every recipient type has its own column.
        NULLIF(COALESCE(co.co_direct, co.co_sub), '') AS case_officer,
        co.quality              AS quality,
        co.tech_support         AS tech_support,
        co.business_development AS business_development,
        -- Last Note (2026-08): the date/time of this person's most recent
        -- note (= last logged contact) — "ngày take note cuối cùng" per the
        -- CEO's own framing. Notes are stored per STUDENT (student_notes has
        -- no lead_id), so this is the last note across that person's whole
        -- history, not scoped to just this particular lead cycle — same
        -- caveat as every other person-level column already on this list
        -- (personCreatedAt etc.). A raw timestamp, not to_char'd, matching
        -- how created_at/updated_at are handled elsewhere in this query.
        ln.last_note_at AS last_note_at
      FROM leads l JOIN students s ON s.student_id = l.person_id
      LEFT JOIN LATERAL (
        SELECT MAX(sn.created_at) AS last_note_at
          FROM student_notes sn
         WHERE sn.student_id = s.student_id
      ) ln ON true
      LEFT JOIN LATERAL (
        SELECT bool_or(true) AS has_slot,
               (array_agg(NULLIF(oa.staff_name,'')
                  ORDER BY (oa.staff_name IS NOT NULL AND oa.staff_name <> '') DESC, oa.updated_at DESC))[1] AS owner
          FROM order_assignments oa
         WHERE oa.student_id = s.student_id AND (
            (s.order_phase = 'Pool'                AND oa.position IN ('Quality','Tech Support'))            OR
            (s.order_phase = 'Presales'            AND oa.position = 'PreSales')                             OR
            (s.order_phase = 'Marketing'           AND oa.position = 'Marketing Staff')                      OR
            (s.order_phase = 'Counselling'         AND oa.position IN ('Counselor','Senior Counselor'))      OR
            (s.order_phase = 'Business Development' AND oa.position = 'Business Development')                 OR
            (s.order_phase = 'Case Officers'       AND oa.position IN ('Case Officer, Direct','Case Officer, Sub'))
         )
      ) po ON true
      LEFT JOIN LATERAL (
        SELECT MAX(CASE WHEN oa.position = 'Case Officer, Direct'  THEN NULLIF(oa.staff_name,'') END) AS co_direct,
               MAX(CASE WHEN oa.position = 'Case Officer, Sub'     THEN NULLIF(oa.staff_name,'') END) AS co_sub,
               MAX(CASE WHEN oa.position = 'Quality'               THEN NULLIF(oa.staff_name,'') END) AS quality,
               MAX(CASE WHEN oa.position = 'Tech Support'          THEN NULLIF(oa.staff_name,'') END) AS tech_support,
               MAX(CASE WHEN oa.position = 'Business Development'  THEN NULLIF(oa.staff_name,'') END) AS business_development
          FROM order_assignments oa
         WHERE oa.student_id = s.student_id
      ) co ON true`;
    let query, params;
    if (!q || q.trim() === '') {
      query = `${base} ORDER BY s.created_at DESC NULLS LAST`;
      params = [];
    } else {
      const search = '%' + q.replace(/\*/g, '%').toLowerCase() + '%';
      query = `${base}
        WHERE LOWER(s.full_name) LIKE $1 OR LOWER(s.email) LIKE $1 OR s.phone LIKE $1
        ORDER BY s.created_at DESC NULLS LAST`;
      params = [search];
    }
    const result = await pool.query(query, params);
    await pool.end();
    const staff = { role: req.session.staffRole, fullName: req.session.staffName };
    const scope = await permissionService.getResourceScope(staff.role, 'leads', 'view_list');
    if (scope === 'none') return res.status(403).json({ success: false, error: 'You do not have permission to view leads.' });
    let leads = result.rows.map(objectToCamelCase);
    if (scope === 'own') {
      // Reporting visibility: only leads whose Order sits in MY department's phase
      // (a counsellor → Counselling; an Order moved to Pool/Case Officer drops off).
      // Use the SESSION position (the record I logged in with) — NOT a full_name
      // lookup, which is ambiguous when a person has duplicate staff rows (e.g. an
      // 'Event staff' rep record) and would wrongly resolve the phase to Pool.
      const myPhase = phaseForPosition(req.session.staffPosition || null);
      // Own list mirrors the Dashboard reporting rule per phase (single source of
      // truth in orderPhase.isReportableStatus): Counselling = active book only;
      // Pre-Sales / Pool = every status. The name stays on the record either way.
      leads = leads.filter(l =>
        permissionService.isLeadAssignedTo(staff, l)
        && l.orderPhase === myPhase
        && isReportableStatus(myPhase, l.leadStatus));
    }
    const masked = await permissionService.applyFieldPermissionsToList(staff, leads);
    // Re-attach leadId/studentId — they aren't catalog fields, so masking may drop
    // them, but the list needs them to navigate to /lead/:leadId or /students/:id.
    const data = masked.map((m, i) => ({ ...m, leadId: leads[i].leadId, studentId: leads[i].studentId }));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// ── Student Detail ────────────────────────────────────────────
async function getStudent(req, res, next) {
  try {
    const { Pool } = require('pg');
    const { logView } = require('./auditController');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM students WHERE student_id = $1`, [id]
    );
    await pool.end();
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    const lead = objectToCamelCase(result.rows[0]);

    const staff = {
      role:     req.session.staffRole,
      fullName: req.session.staffName,
    };

    const canAccess = await permissionService.canAccessLead(
      staff, lead, 'view_detail'
    );
    if (!canAccess) {
      return res.status(403).json({
        success: false,
        error: 'Access denied — this lead is assigned to another staff member.',
      });
    }

    await logView({
      studentId: id,
      viewedBy:  req.session.staffName || req.session.staffEmail || 'unknown',
      req,
    });

    const masked = await permissionService.applyFieldPermissions(staff, lead, 'detail');

    // Phase-driven assignment context: every position's current owner, the
    // positions this phase lets us edit, and the legal next phases. Powers the
    // Sales Order phase mover + phase-gated staff fields on the person view.
    const OrderAssignment = require('../models/OrderAssignment');
    const phase = masked.orderPhase || null;
    const assignments = await OrderAssignment.getForOrder(id);
    // Code-driven canonical phase model (onward phases + this phase's slots).
    const editablePositions = phase ? slotsForPhase(phase) : [];
    const nextPhases = phase ? allowedTransitions(phase) : [];

    res.json({ success: true, data: { ...masked, assignments, editablePositions, nextPhases } });
  } catch (err) { next(err); }
}

// ── Student Update ────────────────────────────────────────────
async function updateStudent(req, res, next) {
  try {
    const role = req.session.staffRole;
    if (role) {
      const filteredBody = {};
      for (const key of Object.keys(req.body)) {
        const canEdit = await permissionService.canEditField(role, 'leads', key);
        if (canEdit) {
          filteredBody[key] = req.body[key];
        }
      }
      req.body = filteredBody;
    }

    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    const { id } = req.params;
    const READONLY = new Set(['studentId', 'createdAt', 'updatedAt']);
    const existing = await pool.query(
      `SELECT * FROM students WHERE student_id = $1`, [id]
    );

    if (existing.rows.length === 0) {
      await pool.end();
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }
    const oldData = objectToCamelCase(existing.rows[0]);
    const editStaff = { role: req.session.staffRole, fullName: req.session.staffName };
    const canEditLead = await permissionService.canAccessLead(editStaff, oldData, 'edit');
    if (!canEditLead) {
      await pool.end();
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to edit this lead.',
      });
    }

    const fields = [], values = [];
    let i = 1;
    const seen = new Set();
    // Engagement fields live on leads now — never write them to students (they are
    // dropped from that table); edits to these go through the lead endpoints.
    const ENGAGEMENT = new Set([
      'counselor', 'senior_counselor', 'presales', 'marketing_staff', 'lead_status',
      'distribution_status', 'close_date', 'confidence', 'office', 'prev_counselor',
      'destination_country', 'timeline', 'study_plans', 'process_application', 'major',
    ]);
    for (const key of Object.keys(req.body)) {
      if (READONLY.has(key)) continue;
      const col = toSnakeCase(key);
      if (ENGAGEMENT.has(col)) continue;
      if (seen.has(col)) continue;
      seen.add(col);
      fields.push(`${col} = $${i}`);
      values.push(req.body[key] === '' || req.body[key] === null || req.body[key] === undefined ? null : req.body[key]);
      i++;
    }
    if (fields.length === 0) { await pool.end(); return res.json({ success: true }); }
    fields.push(`updated_at = $${i}`);
    values.push(new Date());
    i++;
    values.push(id);
    await pool.query(
      `UPDATE students SET ${fields.join(', ')} WHERE student_id = $${i}`, values
    );
    await logChanges({
      studentId: id,
      changedBy: req.session.staffName || req.session.staffEmail || 'unknown',
      oldData,
      newData: req.body,
      source: 'staff_app',
    });
    await issueAdvanceTokens(pool, id);   // auto-mint advance QR if this lead now qualifies
    await pool.end();
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ── Calculate Risk Score ──────────────────────────────────────
async function calculateRisk(req, res, next) {
  try {
    const Student = require('../models/Student');
    const { calculateRiskScore } = require('../utils/riskCalculator');
    const { id } = req.params;

    const result = await Student.findById(id);
    if (!result) return res.status(404).json({ success: false, error: 'Lead not found' });

    const editStaff = { role: req.session.staffRole, fullName: req.session.staffName };
    const canEditRisk = await permissionService.canAccessLead(editStaff, result.data, 'edit');
    if (!canEditRisk) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to recalculate risk for this lead.',
      });
    }

    // Post-split, two scored fields live ONLY on the lead: destinationCountry and
    // timeline. (leadSource, interaction, residency + all self-assessment stay on
    // the student.) So risk must be scored against the person's FIRST ACTIVE lead
    // for those two — not the student record alone, which would leave them blank
    // and understate the score. Pick the earliest non-terminal lead (fallback:
    // earliest lead if none are active) and overlay only its lead-only fields.
    const leadRow = (await pool.query(
      `SELECT destination_country, timeline, lead_status, lead_id
         FROM leads WHERE person_id = $1
        ORDER BY (lead_status NOT IN ('Contracted','Lost','Archived')) DESC, lead_id ASC
        LIMIT 1`,
      [id]
    )).rows[0];
    const firstActiveLead = leadRow ? objectToCamelCase(leadRow) : {};
    const riskInput = { ...result.data };
    for (const f of ['destinationCountry', 'timeline']) {
      const v = firstActiveLead[f];
      if (v !== undefined && v !== null && v !== '') riskInput[f] = v;
    }

    const riskResult = calculateRiskScore(riskInput);

    await Student.update(id, {
      riskScore: String(riskResult.totalScore),
      stoneTier: riskResult.stoneTier,
    });
    res.json({ success: true, data: riskResult });
  } catch (err) { next(err); }
}

// ── Calculate OCEAN Profile ───────────────────────────────────
async function calculateOceanStudent(req, res, next) {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    const { id } = req.params;
    const existing = await pool.query(
      `SELECT * FROM students WHERE student_id = $1`, [id]
    );
    if (existing.rows.length === 0) {
      await pool.end();
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    const data = objectToCamelCase(existing.rows[0]);

    const editStaff = { role: req.session.staffRole, fullName: req.session.staffName };
    const canEditOcean = await permissionService.canAccessLead(editStaff, data, 'edit');
    if (!canEditOcean) {
      await pool.end();
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to recalculate OCEAN for this lead.',
      });
    }

    const responses = {};
    for (let i = 1; i <= 15; i++) {
      responses[i] = Number(data[`oceanQ${i}`]) || 0;
    }
    const assessment = assessOcean(responses);
    await pool.query(
      `UPDATE students SET
        ocean_extraversion      = $1,
        ocean_agreeableness     = $2,
        ocean_conscientiousness = $3,
        ocean_neuroticism       = $4,
        ocean_openness          = $5,
        updated_at              = NOW()
       WHERE student_id = $6`,
      [
        assessment.scores.extraversion,
        assessment.scores.agreeableness,
        assessment.scores.conscientiousness,
        assessment.scores.neuroticism,
        assessment.scores.openness,
        id,
      ]
    );
    await pool.end();
    res.json({ success: true, data: assessment });
  } catch (err) { next(err); }
}

// ── Column Config ─────────────────────────────────────────────
async function getColumnConfig(req, res, next) {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    const { screen } = req.params;
    const result = await pool.query(
      `SELECT config FROM column_config WHERE screen = $1`, [screen]
    );
    await pool.end();
    if (result.rows.length === 0) return res.json({ success: true, data: null });
    res.json({ success: true, data: result.rows[0].config });
  } catch (err) { next(err); }
}

async function saveColumnConfig(req, res, next) {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    const { screen } = req.params;
    const config = req.body.config;
    const updatedBy = req.session.staffName;
    await pool.query(
      `INSERT INTO column_config (screen, config, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (screen) DO UPDATE
       SET config = $2, updated_by = $3, updated_at = NOW()`,
      [screen, JSON.stringify(config), updatedBy]
    );
    await pool.end();
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ── Export to Excel ───────────────────────────────────────────
// POST /api/staff/students/export-excel
// Body: { startDate, endDate, dateField, fields, includeNotes }
// Returns a binary .xlsx file as a download.
async function exportExcel(req, res, next) {
  try {
    const XLSX = require('xlsx');
    const { startDate, endDate, dateField = 'created_at', fields, includeNotes } = req.body;

    const conditions = [];
    const params     = [];

    if (startDate) {
      params.push(startDate);
      conditions.push(`${dateField} >= $${params.length}`);
    }
    if (endDate) {
      params.push(endDate);
      conditions.push(`${dateField} <= $${params.length}::date + interval '1 day'`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT * FROM students ${where} ORDER BY created_at DESC`,
      params
    );

    function snakeToCamel(s) {
      return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    }

    const sheetRows = result.rows.map(row => {
      const camel = {};
      for (const [k, v] of Object.entries(row)) {
        camel[snakeToCamel(k)] = v == null ? '' : v;
      }
      if (fields && Array.isArray(fields) && fields.length > 0) {
        const picked = {};
        fields.forEach(f => { picked[f] = camel[f] ?? ''; });
        return picked;
      }
      return camel;
    });

    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');

    const filename = `leads-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const buffer   = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('X-Export-Row-Count', String(result.rows.length));
    res.send(buffer);
  } catch (err) { next(err); }
}

// ── Build a plain-text archive for a deleted lead ──────────────
function buildNotesArchive(student, notes, deletedBy) {
  const sep = '═'.repeat(60);
  const sub = '─'.repeat(60);
  const noteTypeLabels = {
    counselor:  'Counselor Note',
    presales:   'PreSales Note',
    management: 'Management Note',
  };
  const lines = [];
  lines.push(sep);
  lines.push('LEAD DELETION ARCHIVE');
  lines.push(sep);
  lines.push(`Lead:               ${student.full_name || '(no name)'}`);
  lines.push(`Lead ID:            ${student.student_id}`);
  if (student.email) lines.push(`Email:              ${student.email}`);
  if (student.phone) lines.push(`Phone:              ${student.phone}`);
  lines.push(`Status at deletion: ${student.lead_status || 'New'}`);
  lines.push(`Counselor:          ${student.counselor || '(unassigned)'}`);
  lines.push(`Stone tier:         ${student.stone_tier || '(unscored)'}`);
  lines.push(`Created:            ${student.created_at ? new Date(student.created_at).toISOString().replace('T',' ').slice(0,19) : '(unknown)'} UTC`);
  lines.push(`Deleted by:         ${deletedBy}`);
  lines.push(`Deleted at:         ${new Date().toISOString().replace('T',' ').slice(0,19)} UTC`);
  lines.push(`Total notes:        ${notes.length}`);
  lines.push('');
  if (notes.length === 0) {
    lines.push('(No notes were recorded for this lead.)');
    lines.push('');
  } else {
    notes.forEach((n) => {
      const label = noteTypeLabels[n.note_type] || n.note_type;
      const ts    = n.created_at ? new Date(n.created_at).toISOString().replace('T',' ').slice(0,16) : '(no date)';
      lines.push(sub);
      lines.push(`[${label}]  ${ts}  —  by ${n.author_name || '(unknown)'}`);
      lines.push(sub);
      lines.push(n.content || '');
      lines.push('');
    });
  }
  return lines.join('\n');
}

async function deleteStudents(req, res, next) {
  const { studentIds } = req.body;
  if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
    return res.status(400).json({ success: false, error: 'studentIds array is required' });
  }

  const deleteScope = await permissionService.getResourceScope(
    req.session.staffRole, 'leads', 'delete'
  );
  if (deleteScope !== 'all') {
    return res.status(403).json({
      success: false,
      error: 'You do not have permission to delete leads.',
    });
  }

  const deletedBy = req.session?.staffName || req.session?.staffEmail || 'Unknown';
  const archiveResults = [];

  for (const studentId of studentIds) {
    try {
      const sRes = await pool.query(`SELECT * FROM students      WHERE student_id = $1`, [studentId]);
      const nRes = await pool.query(`SELECT * FROM student_notes WHERE student_id = $1 ORDER BY created_at`, [studentId]);
      const student = sRes.rows[0];
      const notes   = nRes.rows;

      if (!student) {
        archiveResults.push({ studentId, status: 'skipped', reason: 'lead not found' });
        continue;
      }

      const content   = buildNotesArchive(student, notes, deletedBy);
      const fileData  = Buffer.from(content, 'utf-8').toString('base64');
      const dateStamp = new Date().toISOString().slice(0, 10);
      const fileName  = `lead-deletion-${studentId}-${dateStamp}.txt`;

      const upload = await driveService.uploadDocument(studentId, {
        fileName,
        type:        'Lead Deletion Archive',
        description: `Lead deleted by ${deletedBy} on ${dateStamp} (${notes.length} note${notes.length !== 1 ? 's' : ''})`,
        fileData:    `data:text/plain;base64,${fileData}`,
      });

      archiveResults.push({ studentId, status: 'archived', notesCount: notes.length, viewUrl: upload.viewUrl });
    } catch (e) {
      console.error(`[deleteStudents] Archive failed for ${studentId}:`, e.message, e.stack);
      archiveResults.push({ studentId, status: 'failed', error: e.message });
    }
  }

  const failed = archiveResults.filter(r => r.status === 'failed');
  if (failed.length > 0) {
    return res.status(500).json({
      success: false,
      error:   'Notes archive failed for one or more leads — deletion aborted to prevent data loss.',
      details: failed,
    });
  }

  const purged = {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Child-first cleanse — leave no orphans (audit trail, leads, events, docs,
    // parked duplicates), whatever each FK's delete rule happens to be. event_desk_visits
    // references notes, so it goes before student_notes; everything before students/leads.
    const wipe = async (label, sql) => { purged[label] = (await client.query(sql, [studentIds])).rowCount; };
    for (const t of STUDENT_CHILD_TABLES) {
      await wipe(t.label, `DELETE FROM ${t.table} WHERE ${t.key} = ANY($1)`);
    }
    await wipe('duplicateReviews', `DELETE FROM duplicate_reviews WHERE incoming_uid = ANY($1) OR matched_ids && $1::text[]`);
    await wipe('students',         `DELETE FROM students          WHERE student_id = ANY($1)`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    return next(err);
  }
  client.release();

  res.json({
    success:  true,
    deleted:  studentIds.length,
    purged,
    archives: archiveResults,
  });
}

// ── Permissions for current user ──────────────────────────────
async function getPermissions(req, res, next) {
  try {
    const role = req.session.staffRole;
    if (!role) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const perms = await permissionService.getAllPermissions(role);
    res.json({ success: true, data: perms });
  } catch (err) { next(err); }
}

// ── Data cleanup (Admin) — all require unrestricted leads.delete (mass-delete gate) ──
async function requireFullDelete(req, res) {
  const scope = await permissionService.getResourceScope(req.session.staffRole, 'leads', 'delete');
  if (scope !== 'all') { res.status(403).json({ success: false, error: 'Unrestricted leads.delete permission required.' }); return false; }
  return true;
}

// Read-only: exactly what a purge of these students would remove, per table.
async function previewDeleteStudents(req, res, next) {
  if (!(await requireFullDelete(req, res))) return;
  const { studentIds } = req.body;
  if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
    return res.status(400).json({ success: false, error: 'studentIds array is required' });
  }
  try {
    const counts = {};
    for (const t of STUDENT_CHILD_TABLES) {
      counts[t.label] = (await pool.query(`SELECT count(*)::int n FROM ${t.table} WHERE ${t.key} = ANY($1)`, [studentIds])).rows[0].n;
    }
    counts.duplicateReviews = (await pool.query(`SELECT count(*)::int n FROM duplicate_reviews WHERE incoming_uid = ANY($1) OR matched_ids && $1::text[]`, [studentIds])).rows[0].n;
    counts.students = (await pool.query(`SELECT count(*)::int n FROM students WHERE student_id = ANY($1)`, [studentIds])).rows[0].n;
    res.json({ success: true, data: counts });
  } catch (err) { next(err); }
}

const orphanSql = (t, verb) =>
  `${verb} FROM ${t.table} x WHERE x.${t.key} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM students s WHERE s.student_id = x.${t.key})`;

// Read-only: rows orphaned by past deletions (their student no longer exists).
async function getOrphans(req, res, next) {
  if (!(await requireFullDelete(req, res))) return;
  try {
    const counts = {}; let total = 0;
    for (const t of STUDENT_CHILD_TABLES) {
      const n = (await pool.query(orphanSql(t, 'SELECT count(*)::int n'))).rows[0].n;
      counts[t.label] = n; total += n;
    }
    res.json({ success: true, data: { counts, total } });
  } catch (err) { next(err); }
}

// Purge those orphans, transactionally, child-first.
async function purgeOrphans(req, res, next) {
  if (!(await requireFullDelete(req, res))) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const purged = {}; let total = 0;
    for (const t of STUDENT_CHILD_TABLES) {
      const n = (await client.query(orphanSql(t, 'DELETE'))).rowCount;
      purged[t.label] = n; total += n;
    }
    await client.query('COMMIT');
    res.json({ success: true, data: { purged, total } });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally { client.release(); }
}

module.exports = {
  login, logout, checkSession,
  listStaff, listActiveStaff, listRoles, listColumns,
  listVariants, createVariant, updateVariant, deleteVariant,
  getMe, createStaff, updateStaff, resetPassword, deactivateStaff,
  assignStaff, massAssign, massMovePhase, changePhase, setAssignment, listStaleReminders, closeReminders, searchStudents, searchLeads, getStudent, updateStudent,
  getColumnConfig, saveColumnConfig,
  calculateRisk, calculateOceanStudent,
  setTarget, setCallTarget, deleteStudents, exportExcel,
  previewDeleteStudents, getOrphans, purgeOrphans,
  getPermissions,
};

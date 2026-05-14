// server/src/controllers/staffController.js

const Staff = require('../models/Staff');
const { Pool } = require('pg');
const driveService = require('../services/driveService');
const { toSnakeCase, objectToCamelCase } = require('../utils/caseConvert');
const { logChanges } = require('./auditController');
const { assessOcean } = require('../utils/oceanCalculator');
const permissionService = require('../services/permissionService');

// Local pool — matches the pattern used elsewhere in this codebase.
// Used only by deleteStudents for the archive query + transactional delete.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── Auth ──────────────────────────────────────────────────────
async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }
    const staff = await Staff.findByEmail(email);
    if (!staff || !staff.is_active) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    const valid = await Staff.verifyPassword(staff, password);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    req.session.staffId       = staff.id;
    req.session.staffEmail    = staff.email;
    req.session.staffRole     = staff.role;
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
// This replaces the hardcoded ROLES = [...] arrays that used to live in
// the frontend, ensuring the role dropdown reflects whatever the RBAC
// tables actually define. Order alphabetical.
async function listRoles(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT DISTINCT role FROM role_permissions ORDER BY role`
    );
    res.json({ success: true, data: result.rows.map(r => r.role) });
  } catch (err) { next(err); }
}

// Returns the full field catalog with column metadata for the Leads list.
// Reads from permission_fields where column_width IS NOT NULL — these are
// the fields that act as columns in the Leads table. Per-role visibility
// is then applied client-side by PermissionsContext.fieldList().
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

// ── Layout variants ─────────────────────────────────────────────
// Per-user named saved layouts. Each variant holds columns, filters, and
// sort state. A user can have multiple variants and pick one as their
// default (auto-loads on page open).

async function listVariants(req, res, next) {
  try {
    const userId = req.session.staffId;
    const page = req.query.page || 'leads';
    const result = await pool.query(
      `SELECT id, name, is_default, config, created_at, updated_at
       FROM layout_variants
       WHERE user_id = $1 AND page = $2
       ORDER BY is_default DESC, name ASC`,
      [userId, page]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
}

async function createVariant(req, res, next) {
  try {
    const userId = req.session.staffId;
    const { page = 'leads', name, config, isDefault } = req.body;
    if (!name || !config) {
      return res.status(400).json({ success: false, error: 'name and config required' });
    }
    if (isDefault) {
      await pool.query(
        `UPDATE layout_variants SET is_default = FALSE
         WHERE user_id = $1 AND page = $2`,
        [userId, page]
      );
    }
    const result = await pool.query(
      `INSERT INTO layout_variants (user_id, page, name, config, is_default)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, is_default, config`,
      [userId, page, name, config, !!isDefault]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'A variant with that name already exists' });
    }
    next(err);
  }
}

async function updateVariant(req, res, next) {
  try {
    const userId = req.session.staffId;
    const { id } = req.params;
    const { name, config, isDefault } = req.body;
    const own = await pool.query(
      `SELECT page FROM layout_variants WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (own.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Variant not found' });
    }
    if (isDefault === true) {
      await pool.query(
        `UPDATE layout_variants SET is_default = FALSE
         WHERE user_id = $1 AND page = $2 AND id <> $3`,
        [userId, own.rows[0].page, id]
      );
    }
    await pool.query(
      `UPDATE layout_variants
       SET name       = COALESCE($1, name),
           config     = COALESCE($2, config),
           is_default = COALESCE($3, is_default),
           updated_at = NOW()
       WHERE id = $4 AND user_id = $5`,
      [name || null, config || null, isDefault === undefined ? null : !!isDefault, id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'A variant with that name already exists' });
    }
    next(err);
  }
}

async function deleteVariant(req, res, next) {
  try {
    const userId = req.session.staffId;
    const { id } = req.params;
    await pool.query(
      `DELETE FROM layout_variants WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
}

async function listActiveStaff(req, res, next) {
  try {
    const staff = await Staff.findAllActive();
    res.json({ success: true, data: staff });
  } catch (err) { next(err); }
}

// ── User Layout Variants ─────────────────────────────────────
// Each user can save multiple named "variants" of a page layout:
//   { columns: [{key, width, visible}], filters: {...}, sort: {field, dir} }
// They can switch between them via the UI on the Leads list.

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
      // Unset any existing default for this user+page
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
    // If marking this as default, first get its page and unset others on the same page
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
       SET name = COALESCE($1, name),
           config = COALESCE($2, config),
           is_default = COALESCE($3, is_default),
           updated_at = NOW()
       WHERE id = $4 AND staff_id = $5
       RETURNING id, name, config, is_default, created_at, updated_at`,
      [name || null, config || null, typeof is_default === 'boolean' ? is_default : null, id, req.session.staffId]
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

// Returns the currently logged-in staff member's full profile.
// Reads ID from the session and looks up the latest record from the DB
// so any role/permission updates take effect on next request.
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
    const { fullName, email, position, role, password } = req.body;
    if (!fullName || !email || !position || !role || !password) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }
    const staff = await Staff.create({ fullName, email, position, role, password });
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
    const { fullName, email, position, role, isActive, viewThreshold } = req.body;
    const staff = await Staff.update(id, { fullName, email, position, role, isActive, viewThreshold });
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

    // ─── Phase 2c: Resource-level assign check ──────────────
    // Replaces the old route-level requireAdminOrManager middleware.
    // For Counselor with scope='own', this allows handing off their
    // own leads but blocks reassigning anyone else's.
    const assignStaffCtx = {
      role: req.session.staffRole,
      fullName: req.session.staffName,
    };
    const targetLead = await pool.query(
      `SELECT counselor, senior_counselor, presales, marketing_staff
       FROM students WHERE unique_id = $1`, [studentId]
    );
    if (targetLead.rows.length === 0) {
      await pool.end();
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    const canAssign = await permissionService.canAccessLead(
      assignStaffCtx, objectToCamelCase(targetLead.rows[0]), 'assign'
    );
    if (!canAssign) {
      await pool.end();
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to reassign this lead.',
      });
    }
    // ─── End Phase 2c assign check ──────────────────────────

    const result = await pool.query(
      `UPDATE students
       SET counselor        = COALESCE($1, counselor),
           senior_counselor = COALESCE($2, senior_counselor),
           presales         = COALESCE($3, presales),
           marketing_staff  = COALESCE($4, marketing_staff)
       WHERE unique_id = $5
       RETURNING unique_id, counselor, senior_counselor, presales, marketing_staff`,
      [counselor, seniorCounselor, presales, marketingStaff, studentId]
    );
    await pool.end();
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Student not found' });
    }
    res.json({ success: true, data: objectToCamelCase(result.rows[0]) });
  } catch (err) { next(err); }
}

async function massAssign(req, res, next) {
  try {
    // ─── Phase 2c: Mass-assign requires scope='all' ──────────
    // Replaces the old route-level requireAdminOrManager middleware.
    // Counselors with scope='own' must use single-assign on each
    // lead — bulk operations on partial-permission roles get
    // unpredictable semantics and we'd rather force the explicit path.
    const massAssignScope = await permissionService.getResourceScope(
      req.session.staffRole, 'leads', 'assign'
    );
    if (massAssignScope !== 'all') {
      return res.status(403).json({
        success: false,
        error: 'Mass-assign requires unrestricted assign permission. Use single-assign for individual leads.',
      });
    }
    // ─── End Phase 2c mass-assign check ──────────────────────

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
    await pool.query(
      `UPDATE students SET ${dbField} = $1 WHERE unique_id = ANY($2)`,
      [value, studentIds]
    );
    await pool.end();
    res.json({ success: true, updated: studentIds.length });
  } catch (err) { next(err); }
}

// ── Student Search ────────────────────────────────────────────
// PHASE 2b: enforces resource-level view_list permission and applies
// field-level masking ('[hidden]' / omitted) according to the user's
// list_permission rules. If a role's view_list scope is 'own', we
// additionally filter to leads the user is assigned to.
async function searchStudents(req, res, next) {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    const { q } = req.query;
    let query, params;
    if (!q || q.trim() === '') {
      query  = `SELECT * FROM students ORDER BY created_at DESC NULLS LAST`;
      params = [];
    } else {
      const search = '%' + q.replace(/\*/g, '%').toLowerCase() + '%';
      query = `
        SELECT * FROM students
        WHERE LOWER(full_name) LIKE $1
           OR LOWER(email)     LIKE $1
           OR phone             LIKE $1
        ORDER BY created_at DESC NULLS LAST`;
      params = [search];
    }
    const result = await pool.query(query, params);
    await pool.end();

    // Build staff context from session for permission checks.
    const staff = {
      role:     req.session.staffRole,
      fullName: req.session.staffName,
    };

    // Resource-level view_list check. Currently 'all' for every role in
    // the seed, but this honours future changes via the admin UI.
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

    // If view_list is 'own', filter to only assigned leads. (Not used by
    // any current role, but the seed could be changed via admin UI.)
    if (scope === 'own') {
      leads = leads.filter(l => permissionService.isLeadAssignedTo(staff, l));
    }

    // Apply per-field masking using each field's list_permission rule.
    const masked = await permissionService.applyFieldPermissionsToList(staff, leads);

    res.json({ success: true, data: masked });
  } catch (err) { next(err); }
}

// ── Student Detail ────────────────────────────────────────────
// PHASE 2b: enforces canAccessLead for view_detail (returns 403 if a
// Counselor tries to open a lead they're not assigned to), then masks
// fields the user can't see in detail-context.
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
      `SELECT * FROM students WHERE unique_id = $1`, [id]
    );
    await pool.end();
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    const lead = objectToCamelCase(result.rows[0]);

    // Build staff context from session.
    const staff = {
      role:     req.session.staffRole,
      fullName: req.session.staffName,
    };

    // Access check — for Counselor with scope='own', this is where
    // unassigned leads get blocked. Admin/Manager/Director have
    // scope='all' so they pass through.
    const canAccess = await permissionService.canAccessLead(
      staff, lead, 'view_detail'
    );
    if (!canAccess) {
      return res.status(403).json({
        success: false,
        error: 'Access denied — this lead is assigned to another staff member.',
      });
    }

    // Log the view AFTER the access check passes — no audit trail for
    // blocked attempts (they didn't see anything).
    await logView({
      studentId: id,
      viewedBy:  req.session.staffName || req.session.staffEmail || 'unknown',
      req,
    });

    // Apply field-level masking before sending to client.
    const masked = await permissionService.applyFieldPermissions(staff, lead, 'detail');

    res.json({ success: true, data: masked });
  } catch (err) { next(err); }
}

// ── Student Update ────────────────────────────────────────────
// PHASE 2b (defensive): strip any field the user doesn't have edit
// permission for BEFORE the existing update logic runs. Prevents
// '[hidden]' masked values from being saved back to the DB, and stops
// any client-side bypass of field-level edit restrictions.
//
// Phase 2c will add the resource-level access check (can this user
// even edit this lead?) on top of this field-level filter.
async function updateStudent(req, res, next) {
  try {
    // ─── Phase 2b defensive filter ────────────────────────────
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
    // ─── End Phase 2b filter — existing logic continues below ──

    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    const { id } = req.params;
    const READONLY = new Set(['uniqueId', 'createdAt', 'updatedAt']);
    const existing = await pool.query(
      `SELECT * FROM students WHERE unique_id = $1`, [id]
    );
    
    // ─── Phase 2c: Resource-level edit access check ──────────
    // For scope='own' (Counselor), this blocks edits on leads they
    // aren't assigned to. For scope='all' (Admin/Manager/Director),
    // passes through.
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

    // ─── End Phase 2c access check ───────────────────────────
    const fields = [], values = [];
    let i = 1;
    const seen = new Set();
    for (const key of Object.keys(req.body)) {
      if (READONLY.has(key)) continue;
      const col = toSnakeCase(key);
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
      `UPDATE students SET ${fields.join(', ')} WHERE unique_id = $${i}`, values
    );
    await logChanges({
      studentId: id,
      changedBy: req.session.staffName || req.session.staffEmail || 'unknown',
      oldData,
      newData: req.body,
      source: 'staff_app',
    });
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

    // ─── Phase 2c: Resource-level edit access check ──────────
    const editStaff = { role: req.session.staffRole, fullName: req.session.staffName };
    const canEditRisk = await permissionService.canAccessLead(editStaff, result.data, 'edit');
    if (!canEditRisk) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to recalculate risk for this lead.',
      });
    }

    // ─── End Phase 2c access check ───────────────────────────
    const riskResult = calculateRiskScore(result.data);

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
      `SELECT * FROM students WHERE unique_id = $1`, [id]
    );
    if (existing.rows.length === 0) {
      await pool.end();
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }
    
    const data = objectToCamelCase(existing.rows[0]);

    // ─── Phase 2c: Resource-level edit access check ──────────
    const editStaff = { role: req.session.staffRole, fullName: req.session.staffName };
    const canEditOcean = await permissionService.canAccessLead(editStaff, data, 'edit');
    if (!canEditOcean) {
      await pool.end();
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to recalculate OCEAN for this lead.',
      });
    }
    // ─── End Phase 2c access check ───────────────────────────

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
       WHERE unique_id = $6`,
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

// ── Build a plain-text archive for a deleted lead ──────────────
// Always written at deletion, regardless of whether the lead had notes.
// The header is the forensic record of the deletion event; if notes existed,
// they're appended below.
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
  lines.push(`Lead ID:            ${student.unique_id}`);
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
  const { uniqueIds } = req.body;
  if (!uniqueIds || !Array.isArray(uniqueIds) || uniqueIds.length === 0) {
    return res.status(400).json({ success: false, error: 'uniqueIds array is required' });
  }

  // ─── Phase 2c: Resource-level delete check ──────────────
  // Replaces the old route-level requireAdmin middleware. Per the
  // role_permissions seed, Admin and Director both have scope='all'
  // for delete; everyone else is 'none'.
  const deleteScope = await permissionService.getResourceScope(
    req.session.staffRole, 'leads', 'delete'
  );
  if (deleteScope !== 'all') {
    return res.status(403).json({
      success: false,
      error: 'You do not have permission to delete leads.',
    });
  }
  // ─── End Phase 2c delete check ──────────────────────────

  const deletedBy = req.session?.staffName || req.session?.staffEmail || 'Unknown';  
  const archiveResults = [];   // { studentId, status: 'archived' | 'skipped' | 'failed', viewUrl?, error? }

  // ── PHASE 1: Archive every deletion to Google Drive (per student) ──
  // Every deletion creates a forensic record, regardless of whether the lead
  // had notes attached. The archive content adapts: with notes, it includes
  // them; without, it's just lead metadata + deletion event details.
  // Done before the DB delete so we never lose data if upload succeeds and delete fails.
  for (const studentId of uniqueIds) {
    try {
      const sRes = await pool.query(`SELECT * FROM students      WHERE unique_id = $1`, [studentId]);
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

  // ── If ANY archive failed, abort the deletion ──
  // Keeps notes safe — the user can retry once Drive is healthy.
  const failed = archiveResults.filter(r => r.status === 'failed');
  if (failed.length > 0) {
    return res.status(500).json({
      success: false,
      error:   'Notes archive failed for one or more leads — deletion aborted to prevent data loss.',
      details: failed,
    });
  }

  // ── PHASE 2: Delete in a transaction ──
  // All-or-nothing — if any DELETE fails, the others roll back.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM audit_log     WHERE student_id = ANY($1)`, [uniqueIds]);
    await client.query(`DELETE FROM student_notes WHERE student_id = ANY($1)`, [uniqueIds]);
    await client.query(`DELETE FROM students      WHERE unique_id = ANY($1)`, [uniqueIds]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    return next(err);
  }
  client.release();

  res.json({
    success:  true,
    deleted:  uniqueIds.length,
    archives: archiveResults,
  });
}

// ── Permissions for current user ──────────────────────────────
// PHASE 2b: returns the full permission set for the logged-in user's
// role. Frontend uses this on login to shape its UI — disable edit
// controls on view-only fields, hide rows for unassigned leads, etc.
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

module.exports = {
  login, logout, checkSession,
  listStaff, listActiveStaff, listRoles, listColumns,
  listVariants, createVariant, updateVariant, deleteVariant,
  getMe, createStaff, updateStaff, resetPassword, deactivateStaff,
  assignStaff, massAssign, searchStudents, getStudent, updateStudent,
  getColumnConfig, saveColumnConfig,
  calculateRisk, calculateOceanStudent,
  setTarget, deleteStudents,
  getPermissions,
};

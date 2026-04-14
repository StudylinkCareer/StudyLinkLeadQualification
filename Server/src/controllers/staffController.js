// server/src/controllers/staffController.js

const Staff = require('../models/Staff');
const { toSnakeCase, objectToCamelCase } = require('../utils/caseConvert');
const { logChanges } = require('./auditController');
const { assessOcean } = require('../utils/oceanCalculator');

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

async function listActiveStaff(req, res, next) {
  try {
    const staff = await Staff.findAllActive();
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
    res.json({ success: true, data: result.rows.map(objectToCamelCase) });
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
      `SELECT * FROM students WHERE unique_id = $1`, [id]
    );
    await pool.end();
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }
    await logView({
      studentId: id,
      viewedBy:  req.session.staffName || req.session.staffEmail || 'unknown',
      req,
    });
    res.json({ success: true, data: objectToCamelCase(result.rows[0]) });
  } catch (err) { next(err); }
}

// ── Student Update ────────────────────────────────────────────
async function updateStudent(req, res, next) {
  try {
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
    const oldData = existing.rows.length > 0 ? objectToCamelCase(existing.rows[0]) : {};
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

async function deleteStudents(req, res, next) {
  try {
    const { uniqueIds } = req.body;
    if (!uniqueIds || !Array.isArray(uniqueIds) || uniqueIds.length === 0) {
      return res.status(400).json({ success: false, error: 'uniqueIds array is required' });
    }
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    await pool.query(`DELETE FROM audit_log WHERE student_id = ANY($1)`, [uniqueIds]);
    await pool.query(`DELETE FROM student_notes WHERE student_id = ANY($1)`, [uniqueIds]);
    await pool.query(`DELETE FROM students WHERE unique_id = ANY($1)`, [uniqueIds]);
    await pool.end();
    res.json({ success: true, deleted: uniqueIds.length });
  } catch (err) { next(err); }
}

module.exports = {
  login, logout, checkSession,
  listStaff, listActiveStaff, createStaff, updateStaff, resetPassword, deactivateStaff,
  assignStaff, massAssign, searchStudents, getStudent, updateStudent,
  getColumnConfig, saveColumnConfig,
  calculateRisk, calculateOceanStudent,
  setTarget, deleteStudents,
};

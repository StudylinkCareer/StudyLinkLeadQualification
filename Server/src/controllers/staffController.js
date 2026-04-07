// server/src/controllers/staffController.js

const Staff = require('../models/Staff');
const { toSnakeCase, objectToCamelCase } = require('../utils/caseConvert');

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

// ── Staff Management (Admin only) ────────────────────────────
async function listStaff(req, res, next) {
  try {
    const staff = await Staff.findAll();
    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
}

async function listActiveStaff(req, res, next) {
  try {
    const staff = await Staff.findAllActive();
    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
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
    const { fullName, email, position, role, isActive } = req.body;
    const staff = await Staff.update(id, { fullName, email, position, role, isActive });
    if (!staff) return res.status(404).json({ success: false, error: 'Staff member not found' });
    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
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
  } catch (err) {
    next(err);
  }
}

async function deactivateStaff(req, res, next) {
  try {
    const { id } = req.params;
    const staff = await Staff.deactivate(id);
    if (!staff) return res.status(404).json({ success: false, error: 'Staff member not found' });
    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
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
  } catch (err) {
    next(err);
  }
}

async function massAssign(req, res, next) {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    const { studentIds, field, value } = req.body;

    // Validate against camelCase field names (as sent by the frontend)
    const allowedFields = ['counselor', 'seniorCounselor', 'presales', 'marketingStaff'];
    if (!allowedFields.includes(field)) {
      return res.status(400).json({ success: false, error: 'Invalid assignment field' });
    }
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, error: 'studentIds array is required' });
    }

    // Convert camelCase field name to snake_case for the database
    const dbField = toSnakeCase(field);

    await pool.query(
      `UPDATE students SET ${dbField} = $1 WHERE unique_id = ANY($2)`,
      [value, studentIds]
    );

    await pool.end();

    res.json({ success: true, updated: studentIds.length });
  } catch (err) {
    next(err);
  }
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
    let query;
    let params;

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
  } catch (err) {
    next(err);
  }
}

// ── Student Detail ────────────────────────────────────────────
async function getStudent(req, res, next) {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM students WHERE unique_id = $1`,
      [id]
    );
    await pool.end();

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    res.json({ success: true, data: objectToCamelCase(result.rows[0]) });
  } catch (err) {
    next(err);
  }
}

async function updateStudent(req, res, next) {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    const { id } = req.params;
    const READONLY = new Set(['uniqueId', 'createdAt', 'updatedAt']);

    const fields = [];
    const values = [];
    let i = 1;

    for (const key of Object.keys(req.body)) {
      if (READONLY.has(key)) continue;
      fields.push(`${toSnakeCase(key)} = $${i}`);
      values.push(req.body[key]);
      i++;
    }

    if (fields.length === 0) {
      return res.json({ success: true });
    }

    fields.push(`updated_at = $${i}`);
    values.push(new Date());
    i++;
    values.push(id);

    await pool.query(
      `UPDATE students SET ${fields.join(', ')} WHERE unique_id = $${i}`,
      values
    );
    await pool.end();

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  login, logout, checkSession,
  listStaff, listActiveStaff, createStaff, updateStaff, resetPassword, deactivateStaff,
  assignStaff, massAssign, searchStudents, getStudent, updateStudent,
};

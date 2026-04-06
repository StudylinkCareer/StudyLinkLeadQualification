// server/src/models/Staff.js

const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});



async function findAll() {
  const result = await pool.query(
    `SELECT id, full_name, email, position, role, is_active, created_at
     FROM staff ORDER BY full_name ASC`
  );
  return result.rows;
}

async function findById(id) {
  const result = await pool.query(
    `SELECT id, full_name, email, position, role, is_active, created_at
     FROM staff WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function findByEmail(email) {
  const result = await pool.query(
    `SELECT * FROM staff WHERE email = $1`,
    [email.toLowerCase()]
  );
  return result.rows[0] || null;
}

async function findActiveByRole(role) {
  const result = await pool.query(
    `SELECT id, full_name, email, position, role
     FROM staff WHERE role = $1 AND is_active = true ORDER BY full_name ASC`,
    [role]
  );
  return result.rows;
}

async function findAllActive() {
  const result = await pool.query(
    `SELECT id, full_name, email, position, role
     FROM staff WHERE is_active = true ORDER BY full_name ASC`
  );
  return result.rows;
}

async function create({ fullName, email, position, role, password }) {
  const passwordHash = password ? crypto.createHash('sha256').update(password).digest('hex') : null;
  const result = await pool.query(
    `INSERT INTO staff (full_name, email, position, role, password_hash, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING id, full_name, email, position, role, is_active, created_at`,
    [fullName, email.toLowerCase(), position, role, passwordHash]
  );
  return result.rows[0];
}

async function update(id, { fullName, email, position, role, isActive }) {
  const result = await pool.query(
    `UPDATE staff
     SET full_name = COALESCE($1, full_name),
         email     = COALESCE($2, email),
         position  = COALESCE($3, position),
         role      = COALESCE($4, role),
         is_active = COALESCE($5, is_active)
     WHERE id = $6
     RETURNING id, full_name, email, position, role, is_active, created_at`,
    [fullName, email ? email.toLowerCase() : null, position, role, isActive, id]
  );
  return result.rows[0] || null;
}

async function updatePassword(id, newPassword) {
  const passwordHash = crypto.createHash('sha256').update(newPassword).digest('hex');
  await pool.query(
    `UPDATE staff SET password_hash = $1 WHERE id = $2`,
    [passwordHash, id]
  );
}

async function verifyPassword(staff, password) {
  if (!staff.password_hash) return false;
  return crypto.createHash('sha256').update(password).digest('hex') === staff.password_hash;
}

async function deactivate(id) {
  const result = await pool.query(
    `UPDATE staff SET is_active = false WHERE id = $1
     RETURNING id, full_name, email, position, role, is_active`,
    [id]
  );
  return result.rows[0] || null;
}

module.exports = {
  findAll, findById, findByEmail, findActiveByRole, findAllActive,
  create, update, updatePassword, verifyPassword, deactivate,
};

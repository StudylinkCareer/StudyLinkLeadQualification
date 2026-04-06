// server/src/models/StudentNote.js

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function create({ studentId, noteType, content, authorId, authorName }) {
  const result = await pool.query(
    `INSERT INTO student_notes (student_id, note_type, content, author_id, author_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [studentId, noteType, content, authorId, authorName]
  );
  return result.rows[0];
}

async function listByStudent(studentId) {
  const result = await pool.query(
    `SELECT * FROM student_notes
     WHERE student_id = $1
     ORDER BY created_at DESC`,
    [studentId]
  );
  return result.rows;
}

async function listByStudentAndType(studentId, noteType) {
  const result = await pool.query(
    `SELECT * FROM student_notes
     WHERE student_id = $1 AND note_type = $2
     ORDER BY created_at DESC`,
    [studentId, noteType]
  );
  return result.rows;
}

async function deleteNote(id, authorId) {
  const result = await pool.query(
    `DELETE FROM student_notes
     WHERE id = $1 AND author_id = $2
     RETURNING id`,
    [id, authorId]
  );
  return result.rows[0] || null;
}

module.exports = { create, listByStudent, listByStudentAndType, deleteNote };

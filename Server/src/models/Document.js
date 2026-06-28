// server/src/models/Document.js
// Stores document metadata in PostgreSQL
// Actual files live in Google Drive

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Create table if it doesn't exist
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id           SERIAL PRIMARY KEY,
      document_id  TEXT NOT NULL,
      student_id   TEXT NOT NULL,
      type         TEXT,
      description  TEXT,
      file_name    TEXT,
      drive_file_id TEXT,
      view_url     TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS documents_student_id_idx ON documents(student_id)
  `);
}

ensureTable().catch(err =>
  console.error('[DB] Failed to create documents table:', err.message)
);

// Generate next sequence number for a student's document ID
async function getNextSeq(studentId) {
  const result = await pool.query(
    `SELECT document_id FROM documents WHERE student_id = $1`,
    [studentId]
  );
  if (result.rows.length === 0) return 1;
  let max = 0;
  for (const row of result.rows) {
    const parts = row.document_id.split('-');
    const seq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(seq) && seq > max) max = seq;
  }
  return max + 1;
}

// leadId is optional: set for lead-level documents, NULL for student-level.
async function create({ studentId, leadId, type, description, fileName, driveFileId, viewUrl }) {
  const seq = await getNextSeq(studentId);
  const documentId = `${studentId}-${String(seq).padStart(3, '0')}`;

  const result = await pool.query(
    `INSERT INTO documents
      (document_id, student_id, lead_id, type, description, file_name, drive_file_id, view_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [documentId, studentId, leadId || null, type || '', description, fileName, driveFileId, viewUrl]
  );

  return rowToObj(result.rows[0]);
}

async function listByStudent(studentId) {
  const result = await pool.query(
    `SELECT * FROM documents WHERE student_id = $1 ORDER BY created_at ASC`,
    [studentId]
  );
  return result.rows.map(rowToObj);
}

// Lead-level documents (study / finance / lead-specific).
async function listByLead(leadId) {
  const result = await pool.query(
    `SELECT * FROM documents WHERE lead_id = $1 ORDER BY created_at ASC`,
    [leadId]
  );
  return result.rows.map(rowToObj);
}

// Student-level documents (family / identity) — not tied to any lead.
async function listStudentLevel(studentId) {
  const result = await pool.query(
    `SELECT * FROM documents WHERE student_id = $1 AND lead_id IS NULL ORDER BY created_at ASC`,
    [studentId]
  );
  return result.rows.map(rowToObj);
}

function rowToObj(row) {
  return {
    documentId:  row.document_id,
    studentId:   row.student_id,
    leadId:      row.lead_id,
    type:        row.type,
    description: row.description,
    fileName:    row.file_name,
    driveFileId: row.drive_file_id,
    viewUrl:     row.view_url,
    timestamp:   row.created_at,
  };
}

module.exports = { create, listByStudent, listByLead, listStudentLevel };

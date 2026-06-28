require('dotenv').config();
const pool = require('./db');

// ── Counselor check ──────────────────────────────────────────────────────────
// Any active staff with role Counselor/Manager/Director/Admin counts as a
// "counselor" for Student app tab-access purposes.
async function checkCounselor(email) {
  if (!email) return false;
  const allowedRoles = ['Counselor', 'Manager', 'Director', 'Admin'];
  const result = await pool.query(
    `SELECT role FROM staff
     WHERE LOWER(email) = LOWER($1)
       AND is_active = true
       AND role = ANY($2::text[])`,
    [email.trim(), allowedRoles]
  );
  return result.rows.length > 0;
}

// ── Search duplicates ────────────────────────────────────────────────────────
async function searchDuplicates(email, phone) {
  const result = await pool.query(
    `SELECT * FROM students 
     WHERE (email = $1 AND email != '') 
        OR (phone = $2 AND phone != '')`,
    [email || '', phone || '']
  );
  return result.rows.map(rowToCamelCase);
}

// ── Search students ──────────────────────────────────────────────────────────
async function searchStudents(query) {
  const q = `%${query}%`;
  const result = await pool.query(
    `SELECT * FROM students 
     WHERE full_name ILIKE $1 
        OR email     ILIKE $1 
        OR phone     ILIKE $1 
        OR student_id ILIKE $1
     ORDER BY created_at DESC`,
    [q]
  );
  return result.rows.map(rowToCamelCase);
}

// ── List documents ───────────────────────────────────────────────────────────
async function listDocuments(studentId) {
  const result = await pool.query(
    `SELECT * FROM documents WHERE student_id = $1 ORDER BY timestamp DESC`,
    [studentId]
  );
  return {
    documents: result.rows.map((row) => ({
      documentId:  row.document_id,
      studentId:   row.student_id,
      type:        row.type,
      description: row.description,
      fileName:    row.file_name,
      driveFileId: row.drive_file_id,
      viewUrl:     row.view_url,
      timestamp:   row.timestamp,
    })),
    folderUrl: '',
  };
}

// ── Save document metadata ───────────────────────────────────────────────────
async function saveDocument(studentId, docData) {
  const seqResult = await pool.query(
    `SELECT document_id FROM documents WHERE student_id = $1 ORDER BY timestamp DESC`,
    [studentId]
  );
  let maxSeq = 0;
  for (const row of seqResult.rows) {
    const parts = row.document_id.split('-');
    const seq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }
  const documentId = `${studentId}-${String(maxSeq + 1).padStart(3, '0')}`;

  await pool.query(
    `INSERT INTO documents 
       (document_id, student_id, type, description, file_name, drive_file_id, view_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      documentId,
      studentId,
      docData.type        || '',
      docData.description || '',
      docData.fileName    || '',
      docData.driveFileId || '',
      docData.viewUrl     || '',
    ]
  );

  const result = await pool.query(
    `SELECT * FROM documents WHERE document_id = $1`, [documentId]
  );
  const row = result.rows[0];
  return {
    documentId:  row.document_id,
    studentId:   row.student_id,
    type:        row.type,
    description: row.description,
    fileName:    row.file_name,
    driveFileId: row.drive_file_id,
    viewUrl:     row.view_url,
    timestamp:   row.timestamp,
    folderUrl:   '',
  };
}

// ── Helper ───────────────────────────────────────────────────────────────────
function rowToCamelCase(row) {
  return {
    studentId:  row.student_id,
    fullName:  row.full_name,
    email:     row.email,
    phone:     row.phone,
    status:    row.status,
    createdAt: row.created_at,
  };
}

module.exports = {
  checkCounselor,
  searchDuplicates,
  searchStudents,
  listDocuments,
  saveDocument,
};
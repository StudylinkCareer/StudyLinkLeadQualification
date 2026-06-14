// server/src/models/StudentNote.js

const { Pool } = require('pg');
const { objectToCamelCase } = require('../utils/caseConvert');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function create({ studentId, noteType, content, authorId, authorName, followUpDate, reminderStatus, rescheduledDate, contactPlatform, topic, meetingLocation }) {
  const result = await pool.query(
    `INSERT INTO student_notes
       (student_id, note_type, content, author_id, author_name,
        follow_up_date, reminder_status, rescheduled_date, contact_platform, topic, meeting_location)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [studentId, noteType, content, authorId, authorName,
     followUpDate || null,
     reminderStatus || (followUpDate ? 'active' : null),
     rescheduledDate || null,
     contactPlatform || null,
     topic || null,
     meetingLocation || null]
  );
  return objectToCamelCase(result.rows[0]);
}

async function listByStudent(studentId) {
  const result = await pool.query(
    `SELECT * FROM student_notes
     WHERE student_id = $1
     ORDER BY created_at DESC`,
    [studentId]
  );
  return result.rows.map(objectToCamelCase);
}

async function listByStudentAndType(studentId, noteType) {
  const result = await pool.query(
    `SELECT * FROM student_notes
     WHERE student_id = $1 AND note_type = $2
     ORDER BY created_at DESC`,
    [studentId, noteType]
  );
  return result.rows.map(objectToCamelCase);
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


async function updateReminderStatus(id, { reminderStatus, rescheduledDate }) {
  const result = await pool.query(
    `UPDATE student_notes
     SET reminder_status  = $1,
         rescheduled_date = $2
     WHERE id = $3
     RETURNING *`,
    [reminderStatus, rescheduledDate || null, id]
  );
  return result.rows[0] ? objectToCamelCase(result.rows[0]) : null;
}

// Returns all notes that have a follow_up_date (i.e. reminders).
// Excludes 'closed'. Uses rescheduled_date as the effective date when set.
// staffScope: { staffName, hasAllScope } — restricts to owned leads when !hasAllScope.
async function listReminders(staffScope) {
  const { staffName, hasAllScope } = staffScope;
  let query = `
    SELECT sn.*, s.full_name AS student_name, s.unique_id AS student_unique_id,
           s.counselor, s.presales, s.senior_counselor,
           s.close_date, s.confidence
    FROM student_notes sn
    JOIN students s ON s.unique_id = sn.student_id
    WHERE sn.follow_up_date IS NOT NULL
      AND sn.reminder_status <> 'closed'
  `;
  const params = [];
  if (!hasAllScope) {
    params.push(staffName);
    query += ` AND (s.counselor = $1 OR s.presales = $1 OR s.senior_counselor = $1)`;
  }
  query += ` ORDER BY COALESCE(sn.rescheduled_date, sn.follow_up_date) ASC`;
  const result = await pool.query(query, params);
  return result.rows.map(objectToCamelCase);
}

// Returns counselor-type notes within a date range for comms analytics.
// staffScope: { staffName, hasAllScope }
async function listCommunications(staffScope, since, until) {
  const { staffName, hasAllScope } = staffScope;
  const params = [since, until || new Date()];
  let query = `
    SELECT sn.id, sn.created_at, sn.contact_platform, sn.content, sn.student_id,
           s.full_name AS student_name, s.unique_id AS student_unique_id,
           s.counselor, sn.author_name
    FROM student_notes sn
    JOIN students s ON s.unique_id = sn.student_id
    WHERE sn.note_type = 'counselor'
      AND sn.created_at >= $1
      AND sn.created_at <  $2
  `;
  if (!hasAllScope) {
    params.push(staffName);
    query += ` AND (s.counselor = $${params.length} OR s.presales = $${params.length} OR s.senior_counselor = $${params.length})`;
  }
  query += ` ORDER BY sn.created_at DESC`;
  const result = await pool.query(query, params);
  return result.rows.map(objectToCamelCase);
}


async function appendNote(id, addendumText, followUpDate) {
  // Append addendum text to existing content. Optionally update follow_up_date
  // and reset reminder_status to 'active' when a new follow-up date is given.
  const result = await pool.query(
    `UPDATE student_notes
     SET content          = content || $1,
         follow_up_date   = COALESCE($2, follow_up_date),
         reminder_status  = CASE WHEN $2 IS NOT NULL THEN 'active' ELSE reminder_status END,
         rescheduled_date = CASE WHEN $2 IS NOT NULL THEN NULL    ELSE rescheduled_date END
     WHERE id = $3
     RETURNING *`,
    [addendumText, followUpDate || null, id]
  );
  return result.rows[0] ? objectToCamelCase(result.rows[0]) : null;
}
module.exports = { create, listByStudent, listByStudentAndType, deleteNote, updateReminderStatus, listReminders, listCommunications, appendNote };

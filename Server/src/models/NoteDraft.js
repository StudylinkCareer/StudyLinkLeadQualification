// server/src/models/NoteDraft.js
//
// Cross-device note drafts (confirmed 2026-08) — see the migration
// (addNoteEditsAndDrafts.js) for the full rationale. A draft is created the
// moment a staffer clicks the platform action button (Make phone call / Open
// Zalo / etc.), which is now the point at which the note becomes "locked" —
// before that, nothing is persisted. It stays 'pending' until the staffer
// (from any device) fills in and saves the note, or manually discards it.
// No auto-expiry — a pending draft stays pending forever until acted on.

const { Pool } = require('pg');
const { objectToCamelCase } = require('../utils/caseConvert');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function create({ staffId, staffName, studentId, leadId, method, noteType, contactName, contactPhone, contactEmail }) {
  const result = await pool.query(
    `INSERT INTO note_drafts
       (staff_id, staff_name, student_id, lead_id, method, note_type, contact_name, contact_phone, contact_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [staffId, staffName, studentId, leadId || null, method, noteType,
     contactName || null, contactPhone || null, contactEmail || null]
  );
  return objectToCamelCase(result.rows[0]);
}

// Pending drafts for one staffer — powers the banner/badge + resume list.
async function listPending(staffId) {
  const result = await pool.query(
    `SELECT d.*, s.full_name AS student_full_name
       FROM note_drafts d
       JOIN students s ON s.student_id = d.student_id
      WHERE d.staff_id = $1 AND d.status = 'pending'
      ORDER BY d.created_at ASC`,
    [staffId]
  );
  return result.rows.map(objectToCamelCase);
}

async function countPending(staffId) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS c FROM note_drafts WHERE staff_id = $1 AND status = 'pending'`,
    [staffId]
  );
  return result.rows[0].c;
}

// Scoped to staffId so a draft can only be fetched/resumed by whoever created
// it — same "own drafts only" rule as discard/complete below.
async function getById(id, staffId) {
  const result = await pool.query(
    `SELECT * FROM note_drafts WHERE id = $1 AND staff_id = $2`,
    [id, staffId]
  );
  return result.rows[0] ? objectToCamelCase(result.rows[0]) : null;
}

async function discard(id, staffId) {
  const result = await pool.query(
    `UPDATE note_drafts SET status = 'discarded', discarded_at = NOW()
      WHERE id = $1 AND staff_id = $2 AND status = 'pending'
      RETURNING id`,
    [id, staffId]
  );
  return result.rows[0] || null;
}

async function complete(id, staffId, noteId) {
  const result = await pool.query(
    `UPDATE note_drafts SET status = 'completed', completed_at = NOW(), completed_note_id = $3
      WHERE id = $1 AND staff_id = $2 AND status = 'pending'
      RETURNING id`,
    [id, staffId, noteId]
  );
  return result.rows[0] || null;
}

// ── Admin dashboard (CEO + Huy Anh, confirmed 2026-08) ──────────────────
// Every draft, any staffer, any status — with the student's name and, for
// completed ones, the actual note content that was eventually written
// (joined via completed_note_id) so the dashboard can show it inline.
async function listAllForAdmin() {
  const result = await pool.query(`
    SELECT d.*, s.full_name AS student_full_name,
           sn.content AS completed_note_content, sn.created_at AS completed_note_created_at
      FROM note_drafts d
      JOIN students s ON s.student_id = d.student_id
      LEFT JOIN student_notes sn ON sn.id = d.completed_note_id
     ORDER BY d.created_at DESC
  `);
  return result.rows.map(objectToCamelCase);
}

// Macro stats for the same dashboard — counts, completion rate, average
// time-to-complete, per-staff and per-day breakdowns. One query per metric
// rather than one giant query, since each shapes differently and this
// endpoint isn't called often enough to matter.
async function getAdminStats() {
  const byStatus = await pool.query(`SELECT status, COUNT(*)::int AS count FROM note_drafts GROUP BY status`);
  const avgCompletion = await pool.query(`
    SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at)))::float AS avg_seconds
      FROM note_drafts WHERE status = 'completed'
  `);
  const byStaff = await pool.query(`
    SELECT staff_id, staff_name,
           COUNT(*) FILTER (WHERE status = 'pending')::int   AS pending,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
           COUNT(*) FILTER (WHERE status = 'discarded')::int AS discarded,
           COUNT(*)::int AS total
      FROM note_drafts
     GROUP BY staff_id, staff_name
     ORDER BY total DESC
  `);
  const byDay = await pool.query(`
    SELECT (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day, COUNT(*)::int AS c
      FROM note_drafts GROUP BY 1 ORDER BY 1
  `);
  const byMethod = await pool.query(`SELECT method, COUNT(*)::int AS count FROM note_drafts GROUP BY method ORDER BY count DESC`);
  return {
    byStatus: byStatus.rows.map(objectToCamelCase),
    avgCompletionSeconds: avgCompletion.rows[0].avg_seconds,
    byStaff: byStaff.rows.map(objectToCamelCase),
    byDay: byDay.rows.map(r => ({ day: r.day.toISOString().slice(0, 10), count: r.c })),
    byMethod: byMethod.rows.map(objectToCamelCase),
  };
}

module.exports = {
  create, listPending, countPending, getById, discard, complete,
  listAllForAdmin, getAdminStats,
};

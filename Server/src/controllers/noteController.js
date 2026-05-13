// server/src/controllers/noteController.js
//
// CHANGES (table-driven RBAC migration):
//   - Removed the hardcoded canWriteNoteType() function which compared
//     role-name strings against literal arrays.
//   - Note-write permissions now come from role_permissions table via
//     permissionService.getResourceScope(role, 'notes', `write_${noteType}`).
//   - For scope='own', we additionally verify that the lead is assigned to
//     the calling staff member (mirrors how leads.edit with scope='own'
//     works elsewhere).

const { Pool } = require('pg');
const StudentNote = require('../models/StudentNote');
const permissionService = require('../services/permissionService');
const { objectToCamelCase } = require('../utils/caseConvert');

// Same connection pattern used elsewhere in the codebase — local pool,
// SSL only in production.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function getNotes(req, res, next) {
  try {
    const { studentId } = req.params;
    const notes = await StudentNote.listByStudent(studentId);
    res.json({ success: true, data: notes });
  } catch (err) {
    next(err);
  }
}

async function addNote(req, res, next) {
  try {
    const { studentId } = req.params;
    const { noteType, content } = req.body;
    const staffRole = req.session.staffRole;
    const staffName = req.session.staffName;
    const authorId  = req.session.staffId;
    const authorName = staffName;

    if (!noteType || !content) {
      return res.status(400).json({ success: false, error: 'Note type and content are required' });
    }

    // ─── Table-driven permission check ────────────────────────
    // Validate noteType against a known set first so we don't construct
    // arbitrary permission keys.
    const ALLOWED_NOTE_TYPES = ['counselor', 'presales', 'management'];
    if (!ALLOWED_NOTE_TYPES.includes(noteType)) {
      return res.status(400).json({ success: false, error: 'Invalid note type' });
    }

    const operation = `write_${noteType}`;
    const scope = await permissionService.getResourceScope(staffRole, 'notes', operation);

    if (!scope || scope === 'none') {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to write this note type.',
      });
    }

    // For scope='own', verify the lead is assigned to this staff member.
    if (scope === 'own') {
      const leadRes = await pool.query(
        `SELECT counselor, senior_counselor, presales, marketing_staff
         FROM students WHERE unique_id = $1`,
        [studentId]
      );
      if (leadRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Lead not found' });
      }
      const lead = objectToCamelCase(leadRes.rows[0]);
      const isAssigned =
        lead.counselor       === staffName ||
        lead.seniorCounselor === staffName ||
        lead.presales        === staffName ||
        lead.marketingStaff  === staffName;
      if (!isAssigned) {
        return res.status(403).json({
          success: false,
          error: 'You can only write notes on leads assigned to you.',
        });
      }
    }

    const note = await StudentNote.create({ studentId, noteType, content, authorId, authorName });
    res.status(201).json({ success: true, data: note });
  } catch (err) {
    next(err);
  }
}

async function deleteNote(req, res, next) {
  try {
    const { id } = req.params;
    const authorId = req.session.staffId;
    const deleted = await StudentNote.deleteNote(id, authorId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Note not found or not yours to delete' });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { getNotes, addNote, deleteNote };

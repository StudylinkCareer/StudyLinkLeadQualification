// server/src/controllers/noteController.js
//
// CHANGES (table-driven RBAC migration):
//   - Removed the hardcoded canWriteNoteType() function which compared
//     role-name strings against literal arrays.
//   - Note-write permissions now come from role_permissions table via
//     permissionService.getResourceScope(role, 'notes', `write_${noteType}`).
//   - For scope='own', we additionally verify that the lead is assigned to
//     the calling staff member (mirrors how leads.edit with scope='own'
//     works elsewhere)

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
    const { noteType, content, followUpDate, reminderStatus, rescheduledDate, contactPlatform, topic } = req.body;
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

    const note = await StudentNote.create({ studentId, noteType, content, authorId, authorName, followUpDate, reminderStatus, rescheduledDate, contactPlatform, topic });
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


async function updateReminder(req, res, next) {
  try {
    const { id }     = req.params;
    const { reminderStatus, rescheduledDate } = req.body;

    const VALID = ['active', 'closed', 'rescheduled'];
    if (!VALID.includes(reminderStatus)) {
      return res.status(400).json({ success: false, error: 'Invalid reminder status' });
    }
    if (reminderStatus === 'rescheduled' && !rescheduledDate) {
      return res.status(400).json({ success: false, error: 'rescheduledDate is required when rescheduling' });
    }

    const updated = await StudentNote.updateReminderStatus(id, { reminderStatus, rescheduledDate });
    if (!updated) return res.status(404).json({ success: false, error: 'Note not found' });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

async function getReminders(req, res, next) {
  try {
    const staffName  = req.session.staffName;
    const staffRole  = req.session.staffRole;
    const hasAllScope = ['Admin', 'Manager', 'Director'].includes(staffRole);
    const reminders = await StudentNote.listReminders({ staffName, hasAllScope });
    res.json({ success: true, data: reminders });
  } catch (err) {
    next(err);
  }
}

async function getCommunications(req, res, next) {
  try {
    const staffName   = req.session.staffName;
    const staffRole   = req.session.staffRole;
    const hasAllScope = ['Admin', 'Manager', 'Director'].includes(staffRole);

    // Default: 3 months back
    const until = new Date();
    const since = new Date(until);
    since.setMonth(since.getMonth() - 3);

    const comms = await StudentNote.listCommunications({ staffName, hasAllScope }, since, until);
    res.json({ success: true, data: comms });
  } catch (err) {
    next(err);
  }
}


async function appendToNote(req, res, next) {
  try {
    const { id }                       = req.params;
    const { text, followUpDate }       = req.body;
    const staffName                    = req.session.staffName;

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Addendum text is required' });
    }

    // Verify the note exists and the caller has write access to its note type
    const noteRes = await pool.query('SELECT * FROM student_notes WHERE id = $1', [id]);
    if (noteRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Note not found' });
    }
    const note      = objectToCamelCase(noteRes.rows[0]);
    const operation = `write_${note.noteType}`;
    const scope     = await permissionService.getResourceScope(req.session.staffRole, 'notes', operation);

    if (!scope || scope === 'none') {
      return res.status(403).json({ success: false, error: 'Permission denied' });
    }
    if (scope === 'own') {
      const leadRes = await pool.query('SELECT counselor, senior_counselor, presales, marketing_staff FROM students WHERE unique_id = $1', [note.studentId]);
      if (leadRes.rows.length === 0) return res.status(404).json({ success: false, error: 'Lead not found' });
      const lead = objectToCamelCase(leadRes.rows[0]);
      const isAssigned = lead.counselor === staffName || lead.seniorCounselor === staffName || lead.presales === staffName || lead.marketingStaff === staffName;
      if (!isAssigned) return res.status(403).json({ success: false, error: 'You can only append to notes on your own leads.' });
    }

    const updated = await StudentNote.appendNote(id, text, followUpDate || null);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}
module.exports = { getNotes, addNote, deleteNote, updateReminder, getReminders, getCommunications, appendToNote };

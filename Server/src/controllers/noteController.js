// server/src/controllers/noteController.js

const StudentNote = require('../models/StudentNote');

// Permission check — who can write which note type
function canWriteNoteType(role, noteType) {
  if (noteType === 'counselor')  return ['Counselor', 'Manager'].includes(role);
  if (noteType === 'presales')   return ['Counselor', 'Manager'].includes(role);
  if (noteType === 'management') return ['Director', 'Manager'].includes(role);
  return false;
}

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
    const authorId  = req.session.staffId;
    const authorName = req.session.staffName;

    if (!noteType || !content) {
      return res.status(400).json({ success: false, error: 'Note type and content are required' });
    }

    if (!canWriteNoteType(staffRole, noteType)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to write this note type' });
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

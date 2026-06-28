// server/src/routes/notes.js

const express    = require('express');
const router     = express.Router();
const noteCtrl   = require('../controllers/noteController');

// Middleware — check staff is logged in
function requireStaffAuth(req, res, next) {
  if (!req.session || !req.session.staffId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  next();
}

router.get('/reminders',        requireStaffAuth, noteCtrl.getReminders);
router.get('/communications',    requireStaffAuth, noteCtrl.getCommunications);
// Lead-level + student-level notes (multi-segment paths declared before /:studentId)
router.get ('/lead/:leadId',            requireStaffAuth, noteCtrl.getLeadNotes);
router.post('/lead/:leadId',            requireStaffAuth, noteCtrl.addLeadNote);
router.get ('/student-level/:studentId', requireStaffAuth, noteCtrl.getStudentLevelNotes);
router.post('/student-level/:studentId', requireStaffAuth, noteCtrl.addStudentLevelNote);
router.get('/:studentId',        requireStaffAuth, noteCtrl.getNotes);
router.post('/:studentId',      requireStaffAuth, noteCtrl.addNote);
router.delete('/:id',           requireStaffAuth, noteCtrl.deleteNote);
router.patch('/:id/reminder',    requireStaffAuth, noteCtrl.updateReminder);
router.patch('/:id/append',      requireStaffAuth, noteCtrl.appendToNote);

module.exports = router;

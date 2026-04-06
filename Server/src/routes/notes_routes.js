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

router.get('/:studentId',       requireStaffAuth, noteCtrl.getNotes);
router.post('/:studentId',      requireStaffAuth, noteCtrl.addNote);
router.delete('/:id',           requireStaffAuth, noteCtrl.deleteNote);

module.exports = router;

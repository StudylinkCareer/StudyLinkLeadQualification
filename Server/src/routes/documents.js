const express = require('express');
const router = express.Router();
const documentController = require('../controllers/documentController');

// Documents are accessed by BOTH the client (student) app and the LM (staff)
// console, so accept either an authenticated student session OR a staff session.
// (Previously these used requireAuth, which only allowed the student session and
// 401'd staff requests — surfacing as the "Session expired" modal on the staff
// Student/Lead detail screens.)
function requireAnyAuth(req, res, next) {
  if (req.session && (req.session.authenticated || req.session.staffId)) return next();
  res.status(401).json({ success: false, error: 'Authentication required' });
}

// Lead-level + student-level documents (literal-prefix routes before /:studentId)
router.get('/lead/:leadId',             requireAnyAuth, documentController.getLeadDocuments);
router.post('/lead/:leadId/upload',     requireAnyAuth, documentController.uploadLeadDocument);
router.get('/student-level/:studentId', requireAnyAuth, documentController.getStudentLevelDocuments);

router.get('/:studentId',         requireAnyAuth, documentController.listDocuments);
router.post('/:studentId/upload', requireAnyAuth, documentController.uploadDocument);

module.exports = router;

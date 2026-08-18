// server/src/routes/leads.js
//
// Lead (engagement) routes, mounted at /api/leads.
//   GET    /api/leads/student/:studentId   list a student's leads
//   POST   /api/leads/student/:studentId   create a new lead for the student
//   GET    /api/leads/:leadId              one lead
//   PUT    /api/leads/:leadId              update a lead's engagement fields
//
// Gated by requireStaffAuth (same local-middleware pattern as the other staff
// routers). Finer per-lead access control is a documented follow-up in
// controllers/leadController.js.

const express  = require('express');
const router   = express.Router();
const leadCtrl = require('../controllers/leadController');

function requireStaffAuth(req, res, next) {
  if (!req.session || !req.session.staffId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  next();
}

router.get ('/',                   requireStaffAuth, leadCtrl.listAll);
// /student/:studentId is declared before /:leadId so the two-segment path wins.
router.get ('/student/:studentId', requireStaffAuth, leadCtrl.listForStudent);
router.post('/student/:studentId', requireStaffAuth, leadCtrl.create);
router.get ('/:leadId',            requireStaffAuth, leadCtrl.getOne);
router.put ('/:leadId',            requireStaffAuth, leadCtrl.update);
// Deferred Uncontactable-transfer trigger (confirmed 2026-08) — the
// frontend calls this on leaving a lead page instead of the transfer
// firing synchronously on note save. See leadController.getOne's comment
// for the self-healing fallback.
router.post('/:leadId/check-transfer', requireStaffAuth, leadCtrl.checkTransfer);

module.exports = router;

// server/src/routes/noteDrafts.js
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/noteDraftController');

function requireStaffAuth(req, res, next) {
  if (!req.session || !req.session.staffId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  next();
}

router.post('/',            requireStaffAuth, ctrl.createDraft);
router.get('/',              requireStaffAuth, ctrl.listPendingDrafts);
// Admin dashboard (confirmed 2026-08) — declared BEFORE /:id so "admin"
// never gets swallowed as an :id param.
router.get('/admin/all',     requireStaffAuth, ctrl.requireDraftsAdmin, ctrl.listAllDraftsForAdmin);
router.get('/admin/stats',   requireStaffAuth, ctrl.requireDraftsAdmin, ctrl.getDraftStatsForAdmin);
router.get('/:id',           requireStaffAuth, ctrl.getDraft);
router.delete('/:id',        requireStaffAuth, ctrl.discardDraft);

module.exports = router;

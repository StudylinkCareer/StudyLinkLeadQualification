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
router.get('/:id',           requireStaffAuth, ctrl.getDraft);
router.delete('/:id',        requireStaffAuth, ctrl.discardDraft);

module.exports = router;

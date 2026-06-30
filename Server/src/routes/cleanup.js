// server/src/routes/cleanup.js
// ---------------------------------------------------------------------------
// Routes for the schema-adaptive Deep Cleanse tool. DESTRUCTIVE — every route
// is gated to Admin / Director, and every delete endpoint also requires an
// explicit { confirm: true } body (enforced in the controller). Read endpoints
// (schema / preview / orphans / by-pattern / duplicates) are non-destructive.
// ---------------------------------------------------------------------------

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/cleanupController');

function requireStaffAuth(req, res, next) {
  if (!req.session || !req.session.staffId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  next();
}

// Hard gate: only Admin / Director may touch the deep-cleanse tool at all.
function requireAdmin(req, res, next) {
  const role = req.session && req.session.staffRole;
  if (role === 'Admin' || role === 'Director') return next();
  return res.status(403).json({ success: false, error: 'Deep Cleanse is restricted to Admin / Director.' });
}

router.use(requireStaffAuth, requireAdmin);

// ── Read / preview (non-destructive) ──
router.get ('/schema',      ctrl.getSchema);
router.post('/preview',     ctrl.preview);       // { ids }
router.get ('/orphans',      ctrl.orphans);
router.get ('/orphans/keys', ctrl.orphanKeys);   // selectable missing-student owners
router.get ('/by-pattern',   ctrl.byPattern);    // ?pattern=
router.get ('/duplicates',  ctrl.duplicates);    // ?by=email|phone

// ── Destructive (require confirm:true in body) ──
router.post('/apply',          ctrl.apply);        // { ids, confirm }
router.post('/orphans/purge',  ctrl.purgeOrphans); // { confirm }

module.exports = router;

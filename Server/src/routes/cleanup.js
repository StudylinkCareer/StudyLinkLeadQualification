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

// Hard gate: only admin-tier profiles may touch the deep-cleanse tool at all.
const { isAdminProfile } = require('../utils/authProfiles');
function requireAdmin(req, res, next) {
  const s = req.session || {};
  if (isAdminProfile(s.staffRole) || isAdminProfile(s.staffPosition)) return next();
  return res.status(403).json({ success: false, error: 'Deep Cleanse is restricted to admin profiles.' });
}

router.use(requireStaffAuth, requireAdmin);

// ── Read / preview (non-destructive) ──
router.get ('/schema',      ctrl.getSchema);
router.post('/preview',     ctrl.preview);       // { ids }
router.get ('/orphans',      ctrl.orphans);
router.get ('/orphans/keys', ctrl.orphanKeys);   // selectable missing-student owners
router.get ('/by-pattern',   ctrl.byPattern);    // ?pattern=
router.get ('/duplicates',  ctrl.duplicates);    // ?by=email|phone
router.get ('/leads-by-pattern', ctrl.leadsByPattern); // ?pattern= (lead-level)
router.post('/lead-preview',     ctrl.leadPreview);    // { leadIds }

// ── Destructive (require confirm:true in body) ──
router.post('/apply',          ctrl.apply);        // { ids, confirm }
router.post('/orphans/purge',  ctrl.purgeOrphans); // { confirm }
router.post('/lead-apply',     ctrl.leadApply);    // { leadIds, confirm } — lead-level

module.exports = router;

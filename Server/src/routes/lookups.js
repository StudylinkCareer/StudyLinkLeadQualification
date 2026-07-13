// server/src/routes/lookups.js
//
// CHANGES:
//   - GET read routes accept staff OR student session (relaxed earlier)
//   - NEW: public read route for a whitelist of safe categories
//     (e.g., referral_source on the pre-login Home page)

const express    = require('express');
const router     = express.Router();
const lookupCtrl = require('../controllers/lookupController');

// ── Whitelist of categories safe to expose without authentication ──
// Anything on the pre-login pages goes here. Keep it tight.
const PUBLIC_CATEGORIES = new Set([
  'referral_source',
  'vietnam_province',
]);

// ── Middleware ────────────────────────────────────────────────
function requireAnyAuth(req, res, next) {
  if (!req.session) return res.status(401).json({ success: false, error: 'Not authenticated' });
  if (req.session.staffId || req.session.authenticated) return next();
  return res.status(401).json({ success: false, error: 'Not authenticated' });
}
function requireStaffAuth(req, res, next) {
  if (!req.session || !req.session.staffId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  next();
}
const { isAdminProfile } = require('../utils/authProfiles');
function requireAdmin(req, res, next) {
  // staffRole holds the auth PROFILE post-migration (not the legacy 'Admin' tier).
  if (!req.session || !isAdminProfile(req.session.staffRole)) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

// ── Public read route — whitelist-only, no auth ───────────────
// GET /api/lookups/public/:category
// Used by Home.jsx (pre-login) for things like the Referral Source dropdown.
router.get('/public/:category', (req, res, next) => {
  if (!PUBLIC_CATEGORIES.has(req.params.category)) {
    return res.status(404).json({ success: false, error: 'Category not publicly accessible' });
  }
  return lookupCtrl.listOne(req, res, next);
});

// ── Authenticated read routes — staff OR student ──────────────
router.get('/',          requireAnyAuth, lookupCtrl.listAll);
router.get('/admin/all', requireStaffAuth, requireAdmin, lookupCtrl.adminListAll);
router.get('/:category', requireAnyAuth, lookupCtrl.listOne);

// ── Write routes — admin only ────────────────────────────────
router.post('/',                    requireStaffAuth, requireAdmin, lookupCtrl.create);
router.put('/:id',                  requireStaffAuth, requireAdmin, lookupCtrl.update);
router.delete('/:id',               requireStaffAuth, requireAdmin, lookupCtrl.softDelete);
router.post('/:id/reactivate',      requireStaffAuth, requireAdmin, lookupCtrl.reactivate);
router.post('/cache/invalidate',    requireStaffAuth, requireAdmin, lookupCtrl.bustCache);

module.exports = router;

// server/src/routes/lookups.js

const express    = require('express');
const router     = express.Router();
const lookupCtrl = require('../controllers/lookupController');

// ── Middleware ────────────────────────────────────────────────
// Matches the auth pattern used by staff.js and students.js.
function requireStaffAuth(req, res, next) {
  if (!req.session || !req.session.staffId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || req.session.staffRole !== 'Admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

// ── Read routes — any authenticated staff ─────────────────────
// GET /api/lookups
router.get('/',                     requireStaffAuth, lookupCtrl.listAll);
// GET /api/lookups/admin/all?includeInactive=true   (must come BEFORE the :category route)
router.get('/admin/all',            requireStaffAuth, requireAdmin, lookupCtrl.adminListAll);
// GET /api/lookups/:category
router.get('/:category',            requireStaffAuth, lookupCtrl.listOne);

// ── Write routes — admin only ────────────────────────────────
router.post('/',                    requireStaffAuth, requireAdmin, lookupCtrl.create);
router.put('/:id',                  requireStaffAuth, requireAdmin, lookupCtrl.update);
router.delete('/:id',               requireStaffAuth, requireAdmin, lookupCtrl.softDelete);
router.post('/:id/reactivate',      requireStaffAuth, requireAdmin, lookupCtrl.reactivate);
router.post('/cache/invalidate',    requireStaffAuth, requireAdmin, lookupCtrl.bustCache);

module.exports = router;

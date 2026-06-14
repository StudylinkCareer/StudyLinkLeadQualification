// server/src/routes/reports.js
//
// Endpoints in the /api/reports namespace.
// Currently just notes-activity; structured so additional reports
// (e.g. pipeline-velocity, conversion-funnel) can drop in later.

const express  = require('express');
const router   = express.Router();
const reportCtrl = require('../controllers/reportController');
const permissionService = require('../services/permissionService');

// ── Middleware: require login ────────────────────────────────
function requireStaffAuth(req, res, next) {
  if (!req.session || !req.session.staffId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  next();
}

// ── Middleware: require a specific permission ────────────────
// Same pattern as routes/staff.js — checks role_permissions table.
// Inside the controller, scope ('all' / 'own') is read again to refine
// the query.
function requirePermission(resource, operation) {
  return async function (req, res, next) {
    try {
      const role = req.session && req.session.staffRole;
      if (!role) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
      }
      const scope = await permissionService.getResourceScope(role, resource, operation);
      if (!scope || scope === 'none') {
        return res.status(403).json({
          success: false,
          error: `You do not have permission to ${operation.replace(/_/g, ' ')} ${resource}.`,
        });
      }
      next();
    } catch (err) { next(err); }
  };
}

router.get(
  '/notes-activity',
  requireStaffAuth,
  requirePermission('reports', 'view'),
  reportCtrl.notesActivity
);

// Contracted pipeline metrics for the Dashboard. Auth-only; scope (own/all)
// is resolved inside the controller, same as the dashboard's lead list.
router.get(
  '/contracted-stats',
  requireStaffAuth,
  reportCtrl.contractedStats
);

router.get(
  '/weekly',
  requireStaffAuth,
  reportCtrl.weeklyReport
);

// Weekly Status Report recommendations (load / upsert), per week + view-scope.
router.get(
  '/weekly-recommendation',
  requireStaffAuth,
  reportCtrl.getRecommendation
);
router.put(
  '/weekly-recommendation',
  requireStaffAuth,
  reportCtrl.saveRecommendation
);

module.exports = router;

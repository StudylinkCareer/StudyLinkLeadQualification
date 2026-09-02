// server/src/routes/reports.js
//
// Endpoints in the /api/reports namespace.
// Currently just notes-activity; structured so additional reports
// (e.g. pipeline-velocity, conversion-funnel) can drop in later.

const express  = require('express');
const router   = express.Router();
const reportCtrl = require('../controllers/reportController');
const permissionService = require('../services/permissionService');
const monthlyReport = require('../services/monthlyReport');

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

// Manual re-publish of a frozen week's snapshot (manager-scope; gated in ctrl).
router.post(
  '/weekly/regenerate',
  requireStaffAuth,
  reportCtrl.regenerateWeeklySnapshot
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

// ── Monthly Targets tracker (Weekly Report) ──────────────────
// View + edit are gated to manager-level scope inside each controller
// (leads/assign = 'all'), mirroring mass-assign.
router.get(
  '/monthly-targets',
  requireStaffAuth,
  reportCtrl.monthlyTargets
);
router.put(
  '/monthly-targets',
  requireStaffAuth,
  reportCtrl.saveMonthlyTarget
);
router.post(
  '/tracked-staff',
  requireStaffAuth,
  reportCtrl.addTrackedStaff
);
router.delete(
  '/tracked-staff/:staffId',
  requireStaffAuth,
  reportCtrl.removeTrackedStaff
);

// ── Call Targets (Monthly Call Volume Targets) — RETIRED 2026-08 ─────
// Routes removed; see reportController.js's "RETIRED" comment above
// callDayTargets for why the underlying tables are left in place.

// ── Call Day Targets (Staff Targets page, "Daily Call Quotas" grid) ──
// Counsellors only now, per-weekday New/Ongoing quotas, per month — drives
// Weekly Report's "Calls by day" table. Same gating as Monthly Targets above.
router.get(
  '/call-day-targets',
  requireStaffAuth,
  reportCtrl.callDayTargets
);
router.put(
  '/call-day-targets',
  requireStaffAuth,
  reportCtrl.saveCallDayTarget
);

// ── Uncontactable → Pre-sales auto-transfer roster ────────────────────
// Same gating as Call/Monthly Targets above.
router.get(
  '/uncontactable-roster',
  requireStaffAuth,
  reportCtrl.listUncontactableRoster
);
router.post(
  '/uncontactable-roster',
  requireStaffAuth,
  reportCtrl.addUncontactableRosterStaff
);
router.delete(
  '/uncontactable-roster/:staffId',
  requireStaffAuth,
  reportCtrl.removeUncontactableRosterStaff
);
router.patch(
  '/uncontactable-roster/:staffId/slot-mode',
  requireStaffAuth,
  reportCtrl.setUncontactableSlotMode
);

// ── Pre-sales working hours (backs the weighted Uncontactable round-robin) ──
router.get(
  '/presales-working-hours',
  requireStaffAuth,
  reportCtrl.presalesWorkingHours
);
router.put(
  '/presales-working-hours',
  requireStaffAuth,
  reportCtrl.savePresalesWorkingHours
);

// ── Sales + Marketing Monthly Report ─────────────────────────
// Same broad-audience gate as notes-activity (Activity Report) — wider
// audience than Event Report's CEO/COO+Managers-only gate, since this report
// is meant for the sales/presales/marketing teams generally.
router.get(
  '/monthly',
  requireStaffAuth,
  requirePermission('reports', 'view'),
  async (req, res, next) => {
    try {
      const month = String(req.query.month || '');
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
      }
      const [sales, marketing] = await Promise.all([
        monthlyReport.getSalesMonthlyReport(month),
        monthlyReport.getMarketingMonthlyReport(month),
      ]);
      res.json({ success: true, data: { ...sales, activities: marketing.activities } });
    } catch (err) { next(err); }
  }
);

router.get(
  '/call-hours',
  requireStaffAuth,
  requirePermission('reports', 'view'),
  async (req, res, next) => {
    try {
      const month = String(req.query.month || '');
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
      }
      const data = await monthlyReport.getCallHours(month);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }
);

router.put(
  '/call-hours',
  requireStaffAuth,
  requirePermission('reports', 'view'),
  async (req, res, next) => {
    try {
      const { staffId, month, hours } = req.body || {};
      if (!staffId || !/^\d+$/.test(String(staffId))) {
        return res.status(400).json({ success: false, error: 'staffId is required' });
      }
      if (!/^\d{4}-\d{2}$/.test(String(month || ''))) {
        return res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
      }
      const updatedBy = req.session.staffName || req.session.staffEmail || 'unknown';
      const data = await monthlyReport.saveCallHours(staffId, month, hours, updatedBy);
      res.json({ success: true, data });
    } catch (err) {
      if (err.message && err.message.includes('non-negative')) {
        return res.status(400).json({ success: false, error: err.message });
      }
      next(err);
    }
  }
);

router.get(
  '/monthly-notes',
  requireStaffAuth,
  requirePermission('reports', 'view'),
  async (req, res, next) => {
    try {
      const month = String(req.query.month || '');
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
      }
      const data = await monthlyReport.getMonthlyNotes(month);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }
);

router.put(
  '/monthly-notes',
  requireStaffAuth,
  requirePermission('reports', 'view'),
  async (req, res, next) => {
    try {
      const { month, content } = req.body || {};
      if (!/^\d{4}-\d{2}$/.test(String(month || ''))) {
        return res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
      }
      const updatedBy = req.session.staffName || req.session.staffEmail || 'unknown';
      const data = await monthlyReport.saveMonthlyNotes(month, content, updatedBy);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }
);

module.exports = router;

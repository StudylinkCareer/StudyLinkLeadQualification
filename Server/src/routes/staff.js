// server/src/routes/staff.js
//
// CHANGES (table-driven RBAC migration):
//   - Removed the locally-defined requireAdmin and requireAdminOrManager
//     middleware functions. They hardcoded role-name strings; permissions
//     are now table-driven via the role_permissions table.
//   - Added requirePermission(resource, operation) — a generic middleware
//     factory that asks permissionService.getResourceScope() whether the
//     logged-in user's role has any scope ('all' or 'own') for the given
//     resource/operation. Returns 403 if scope is 'none'.
//   - Every route that previously used requireAdmin / requireAdminOrManager
//     now uses requirePermission(...) with an entry from the role_permissions
//     table. The role-permissions matrix is the single source of truth.
//   - Added the GET /permissions route used by the frontend
//     PermissionsContext to populate its UI rules on login.

const express    = require('express');
const router     = express.Router();
const staffCtrl  = require('../controllers/staffController');
const auditCtrl  = require('../controllers/auditController');
const permissionService = require('../services/permissionService');

// ── Middleware ────────────────────────────────────────────────
function requireStaffAuth(req, res, next) {
  if (!req.session || !req.session.staffId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  next();
}

// Generic permission middleware: checks role_permissions table for any
// scope (all/own) on (resource, operation). If scope is 'none' or no row
// exists, returns 403. For operations where ownership of a specific
// record matters (e.g. editing a single lead), the controller does its
// own canAccessLead(...) check after this passes — this middleware only
// gates whether the role has ANY business with the resource.
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

// ── Auth routes ───────────────────────────────────────────────
router.post('/login',   staffCtrl.login);
router.post('/logout',  requireStaffAuth, staffCtrl.logout);
router.get('/session',  staffCtrl.checkSession);

// ── Permissions for the logged-in user (used by frontend RBAC) ──
router.get('/permissions', requireStaffAuth, staffCtrl.getPermissions);

// ── Distinct list of role names from role_permissions (used by the
// Staff edit modal to populate its Role dropdown — replaces a hardcoded
// frontend array). Open to any authenticated staff because the page that
// uses it is itself gated by staff.manage at the route level.
router.get('/roles', requireStaffAuth, staffCtrl.listRoles);

// ── Column catalog for the Leads list — replaces the hardcoded
// MASTER_COLUMNS array. Returns every field in permission_fields where
// column_width IS NOT NULL, sorted by column_order. The frontend filters
// by per-role permissions via PermissionsContext.fieldList().
router.get('/columns', requireStaffAuth, staffCtrl.listColumns);

// ── User Layout Variants ──────────────────────────────────────
// Each user can save multiple named layouts (columns + filters + sort)
// per page. CRUD is per-user — every authenticated user can manage
// their own variants regardless of role.
router.get   ('/variants',     requireStaffAuth, staffCtrl.listVariants);
router.post  ('/variants',     requireStaffAuth, staffCtrl.createVariant);
router.put   ('/variants/:id', requireStaffAuth, staffCtrl.updateVariant);
router.delete('/variants/:id', requireStaffAuth, staffCtrl.deleteVariant);

// ── Student routes ────────────────────────────────────────────
// Student-level operations: list/detail/edit access is enforced inside
// the controllers themselves via canAccessLead / applyFieldPermissions.
// Mass delete is gated here at the route layer (leads.delete).
router.get('/students/search',              requireStaffAuth,                                            staffCtrl.searchStudents);
router.get('/students/:id',                 requireStaffAuth,                                            staffCtrl.getStudent);
router.put('/students/:id',                 requireStaffAuth,                                            staffCtrl.updateStudent);
router.post('/students/:id/calculate-risk', requireStaffAuth, requirePermission('leads', 'recalculate'), staffCtrl.calculateRisk);
router.post('/students/:id/calculate-ocean',requireStaffAuth, requirePermission('leads', 'recalculate'), staffCtrl.calculateOceanStudent);
router.delete('/students',                  requireStaffAuth, requirePermission('leads', 'delete'),       staffCtrl.deleteStudents);

// ── Audit log routes ──────────────────────────────────────────
// Per-lead audit log is visible to anyone who can view the lead
// (canAccessLead is enforced when loading the lead itself). Range queries
// and alert recipients are admin-level audit management → audit.view.
router.get('/audit/:studentId',  requireStaffAuth,                                       auditCtrl.getAuditLog);
router.get('/audit-range',       requireStaffAuth, requirePermission('audit', 'view'),   auditCtrl.getAuditLogRange);
router.get('/alert-recipients',  requireStaffAuth, requirePermission('audit', 'view'),   auditCtrl.getRecipients);
router.put('/alert-recipients',  requireStaffAuth, requirePermission('audit', 'view'),   auditCtrl.updateRecipients);

// ── Column config ─────────────────────────────────────────────
// Read is open to any authenticated staff member (the FE needs it on
// every login). Save is gated on column_config.manage.
router.get('/column-config/:screen', requireStaffAuth,                                                staffCtrl.getColumnConfig);
router.put('/column-config/:screen', requireStaffAuth, requirePermission('column_config', 'manage'),  staffCtrl.saveColumnConfig);

// ── Staff management ──────────────────────────────────────────
// listActive and getMe are unrestricted (active staff list is needed by
// assignment dropdowns for any role; getMe returns the caller's own
// record). Everything else respects role_permissions.
router.get('/',              requireStaffAuth, requirePermission('staff', 'manage'),     staffCtrl.listStaff);
router.get('/active',        requireStaffAuth,                                            staffCtrl.listActiveStaff);
router.get('/me',            requireStaffAuth,                                            staffCtrl.getMe);
router.post('/',             requireStaffAuth, requirePermission('staff', 'manage'),     staffCtrl.createStaff);
router.put('/assign/:studentId', requireStaffAuth, requirePermission('leads', 'assign'), staffCtrl.assignStaff);
router.put('/mass-assign',   requireStaffAuth, requirePermission('leads', 'assign'),     staffCtrl.massAssign);
router.put('/:id/target',    requireStaffAuth, requirePermission('staff', 'set_target'), staffCtrl.setTarget);
router.put('/:id/password',  requireStaffAuth, requirePermission('staff', 'manage'),     staffCtrl.resetPassword);
router.put('/:id/deactivate',requireStaffAuth, requirePermission('staff', 'manage'),     staffCtrl.deactivateStaff);
router.put('/:id',           requireStaffAuth, requirePermission('staff', 'manage'),     staffCtrl.updateStaff);

module.exports = router;

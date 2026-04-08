// server/src/routes/staff.js

const express    = require('express');
const router     = express.Router();
const staffCtrl  = require('../controllers/staffController');
const auditCtrl  = require('../controllers/auditController');

// ── Middleware ────────────────────────────────────────────────
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

function requireAdminOrManager(req, res, next) {
  if (!req.session || !['Admin', 'Manager'].includes(req.session.staffRole)) {
    return res.status(403).json({ success: false, error: 'Manager access required' });
  }
  next();
}

// ── Auth routes ───────────────────────────────────────────────
router.post('/login',   staffCtrl.login);
router.post('/logout',  requireStaffAuth, staffCtrl.logout);
router.get('/session',  staffCtrl.checkSession);

// ── Student routes ────────────────────────────────────────────
router.get('/students/search',              requireStaffAuth,                        staffCtrl.searchStudents);
router.get('/students/:id',                 requireStaffAuth,                        staffCtrl.getStudent);
router.put('/students/:id',                 requireStaffAuth,                        staffCtrl.updateStudent);
router.post('/students/:id/calculate-risk', requireStaffAuth,                        staffCtrl.calculateRisk);
router.post('/students/:id/calculate-ocean',requireStaffAuth,                        staffCtrl.calculateOceanStudent);

// ── Audit log routes ──────────────────────────────────────────
router.get('/audit/:studentId',  requireStaffAuth,              auditCtrl.getAuditLog);
router.get('/audit-range',       requireStaffAuth, requireAdmin, auditCtrl.getAuditLogRange);
router.get('/alert-recipients',  requireStaffAuth, requireAdmin, auditCtrl.getRecipients);
router.put('/alert-recipients',  requireStaffAuth, requireAdmin, auditCtrl.updateRecipients);

// ── Column config ─────────────────────────────────────────────
router.get('/column-config/:screen', requireStaffAuth,              staffCtrl.getColumnConfig);
router.put('/column-config/:screen', requireStaffAuth, requireAdmin, staffCtrl.saveColumnConfig);

// ── Staff management ──────────────────────────────────────────
router.get('/',              requireStaffAuth, requireAdmin,           staffCtrl.listStaff);
router.get('/active',        requireStaffAuth,                          staffCtrl.listActiveStaff);
router.post('/',             requireStaffAuth, requireAdmin,           staffCtrl.createStaff);
router.put('/assign/:studentId', requireStaffAuth, requireAdminOrManager, staffCtrl.assignStaff);
router.put('/mass-assign',   requireStaffAuth, requireAdminOrManager,  staffCtrl.massAssign);
router.put('/:id/target',    requireStaffAuth, requireAdminOrManager,  staffCtrl.setTarget);
router.put('/:id/password',  requireStaffAuth, requireAdmin,           staffCtrl.resetPassword);
router.put('/:id/deactivate',requireStaffAuth, requireAdmin,           staffCtrl.deactivateStaff);
router.put('/:id',           requireStaffAuth, requireAdmin,           staffCtrl.updateStaff);

module.exports = router;

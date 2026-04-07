  // server/src/routes/staff.js

  const express    = require('express');
  const router     = express.Router();
  const staffCtrl  = require('../controllers/staffController');

  // Middleware — check staff is logged in
  function requireStaffAuth(req, res, next) {
    if (!req.session || !req.session.staffId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    next();
  }

  // Middleware — check staff is Admin
  function requireAdmin(req, res, next) {
    if (!req.session || req.session.staffRole !== 'Admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    next();
  }

  // Middleware — check staff is Admin or Manager
  function requireAdminOrManager(req, res, next) {
    if (!req.session || !['Admin', 'Manager'].includes(req.session.staffRole)) {
      return res.status(403).json({ success: false, error: 'Manager access required' });
    }
    next();
  }

  // ── Auth routes ──
  router.post('/login',   staffCtrl.login);
  router.post('/logout',  requireStaffAuth, staffCtrl.logout);
  router.get('/session',  staffCtrl.checkSession);

  // ── Student routes ──
  router.get('/students/search',       requireStaffAuth,                         staffCtrl.searchStudents);
  router.get('/students/:id',          requireStaffAuth,                         staffCtrl.getStudent);
  router.put('/students/:id',          requireStaffAuth,                         staffCtrl.updateStudent);

  // ── Column config ──
  router.get('/column-config/:screen',  requireStaffAuth,                          staffCtrl.getColumnConfig);
  router.put('/column-config/:screen',  requireStaffAuth, requireAdmin,            staffCtrl.saveColumnConfig);

  // ── Staff management and Assignment routes (Admin only) ──
  router.get('/',                      requireStaffAuth, requireAdmin,           staffCtrl.listStaff);
  router.get('/active',                requireStaffAuth,                          staffCtrl.listActiveStaff);
  router.post('/',                     requireStaffAuth, requireAdmin,           staffCtrl.createStaff);
  router.put('/assign/:studentId',     requireStaffAuth, requireAdminOrManager,  staffCtrl.assignStaff);
  router.put('/mass-assign',           requireStaffAuth, requireAdminOrManager,  staffCtrl.massAssign);
  router.put('/:id',                   requireStaffAuth, requireAdmin,           staffCtrl.updateStaff);
  router.put('/:id/password',          requireStaffAuth, requireAdmin,           staffCtrl.resetPassword);
  router.put('/:id/deactivate',        requireStaffAuth, requireAdmin,           staffCtrl.deactivateStaff);

  module.exports = router;

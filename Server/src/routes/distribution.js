// Server/src/routes/distribution.js

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/distributionController');

// requireDistribution checks the STAFF session (req.session.staffRole) AND
// distribution.manage = 'all'. (Do NOT use authMiddleware.requireAuth here —
// that checks req.session.authenticated, which is the LQ-client flag, not staff.)
router.use(ctrl.requireDistribution);

// Engine
router.get('/offices', ctrl.listOffices);
router.get('/pool',    ctrl.poolSummary);
router.post('/preview', ctrl.preview);
router.post('/release', ctrl.release);
router.post('/recall',  ctrl.recall);

// In-console upload + template
router.get('/template', ctrl.downloadTemplate);
router.post('/upload', ctrl.uploadLeads);

// Dynamic office-coverage management
router.get('/staff',           ctrl.listStaff);
router.get('/coverage',        ctrl.listCoverage);
router.post('/coverage',       ctrl.addCoverage);
router.patch('/coverage/:id',  ctrl.updateCoverageWeight);
router.delete('/coverage/:id', ctrl.removeCoverage);

// Existing unassigned leads
router.get('/unassigned', ctrl.listUnassigned);
router.post('/pool-existing', ctrl.poolExisting);

// Review staging → manual assign / commit to pool
router.get('/review', ctrl.listReview);
router.post('/assign-manual', ctrl.assignManual);
router.post('/commit-pool', ctrl.commitToPool);
router.post('/pool-to-review', ctrl.poolToReview);

// Notes bulk upload
router.get('/notes-template', ctrl.downloadNotesTemplate);
router.post('/upload-notes', ctrl.uploadNotes);

// Duplicates to review (parked on upload when email/phone collides with a person)
router.get('/duplicates', ctrl.listDuplicates);
router.post('/duplicates/:id/resolve', ctrl.resolveDuplicate);

module.exports = router;

// server/src/routes/students.js
// CHANGES: Added POST /deactivate route
// CHANGES (2026-09, wizard): requireOwnStudent on every :id route (no-op unless
// ENFORCE_STUDENT_OWNERSHIP=true); new PUT /:id/qualification and
// POST /:id/complete-journey.

const express = require('express');
const router = express.Router();
const { requireAuth, requireCounselor } = require('../middleware/authMiddleware');
const { requireOwnStudent } = require('../middleware/studentOwnership');
const studentController = require('../controllers/studentController');

router.post('/register', requireAuth, studentController.register);
router.post('/:id/add-registration', requireAuth, requireOwnStudent, studentController.addRegistration);
router.post('/deactivate', requireAuth, studentController.deactivateRecords);
router.get('/search', requireAuth, requireCounselor, studentController.searchStudents);
router.get('/check-duplicate', requireAuth, studentController.checkDuplicate);
router.get('/by-email', requireAuth, studentController.getByEmail);
router.get('/:id', requireAuth, requireOwnStudent, studentController.getStudent);
router.put('/:id', requireAuth, requireOwnStudent, studentController.updateStudent);
router.put('/:id/qualification', requireAuth, requireOwnStudent, studentController.updateQualification);
router.post('/:id/complete-journey', requireAuth, requireOwnStudent, studentController.completeJourney);
router.post('/:id/calculate-risk', requireAuth, requireOwnStudent, studentController.calculateRisk);
router.post('/:id/calculate-ocean', requireAuth, requireOwnStudent, studentController.calculateOcean);
router.get('/:id/ocean-narrative', requireAuth, requireOwnStudent, studentController.getOceanNarrative);
router.post('/:id/upload-photos', requireAuth, requireOwnStudent, studentController.uploadPhotos);

module.exports = router;

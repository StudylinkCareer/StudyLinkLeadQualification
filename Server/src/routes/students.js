// server/src/routes/students.js
// CHANGES: Added POST /deactivate route

const express = require('express');
const router = express.Router();
const { requireAuth, requireCounselor } = require('../middleware/authMiddleware');
const studentController = require('../controllers/studentController');

router.post('/register', requireAuth, studentController.register);
router.post('/deactivate', requireAuth, studentController.deactivateRecords);
router.get('/search', requireAuth, requireCounselor, studentController.searchStudents);
router.get('/check-duplicate', requireAuth, studentController.checkDuplicate);
router.get('/by-email', requireAuth, studentController.getByEmail);
router.get('/:id', requireAuth, studentController.getStudent);
router.put('/:id', requireAuth, studentController.updateStudent);
router.post('/:id/calculate-risk', requireAuth, studentController.calculateRisk);
router.post('/:id/calculate-ocean', requireAuth, studentController.calculateOcean);
router.post('/:id/upload-photos', requireAuth, studentController.uploadPhotos);

module.exports = router;

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/authMiddleware');
const documentController = require('../controllers/documentController');

router.get('/:studentId', requireAuth, documentController.listDocuments);
router.post('/:studentId/upload', requireAuth, documentController.uploadDocument);

module.exports = router;

// server/src/routes/api.js
// General API routes (health check etc.)

const express = require('express');
const router = express.Router();

// Health check — used by Render to confirm the service is alive
router.get('/health', (req, res) => {
  res.json({ success: true, status: 'ok' });
});

module.exports = router;

// server/src/routes/auth.js
// CHANGES: Added POST /check-login (no auth required — it's part of login flow)

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/check-login', authController.checkLogin);  // ← NEW (pre-auth)
router.post('/login-lookup', authController.loginLookup); // ← NEW (2026-08) — /login page identifier lookup
router.get('/otp-channels', authController.otpChannels);  // ← NEW (2026-08) — which OTP channels are live
router.post('/request-otp', authController.requestOTP);
router.post('/verify-otp', authController.verifyOTP);
router.get('/session', authController.checkSession);
router.post('/logout', authController.logout);
router.post('/qr-login', authController.qrLogin);

module.exports = router;

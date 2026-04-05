// server/src/controllers/authController.js
// CHANGES:
//   - checkLogin() passes fullName + phone to checkCounselor (GAS now validates all three)
//   - verifyOTP() passes fullName + phone to checkCounselor
//   - Both handle the boolean return from the updated checkCounselor().

const otpService = require('../services/otpService');
const emailService = require('../services/emailService');
const { checkCounselor, searchDuplicates } = require('../services/dataService');

// Simple in-memory rate limiter for OTP requests (max 10 per email per 5 min)
const otpRateLimit = new Map();
const OTP_RATE_LIMIT = 10;
const OTP_RATE_WINDOW_MS = 5 * 60 * 1000;

function checkOtpRateLimit(email) {
  const key = email.toLowerCase();
  const now = Date.now();
  const entry = otpRateLimit.get(key);

  if (!entry || now > entry.windowEnd) {
    otpRateLimit.set(key, { count: 1, windowEnd: now + OTP_RATE_WINDOW_MS });
    return true;
  }

  if (entry.count >= OTP_RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

// ─── checkLogin — pre-auth duplicate analysis ────────────────
// Called BEFORE OTP. No auth required. Returns scenario + safe match info.
async function checkLogin(req, res, next) {
  try {
    const { email, phone, fullName } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    // Check if this email belongs to a staff member
    // GAS validates email + fullName + phone together for security
    let isCounselorUser = false;
    try {
      isCounselorUser = await checkCounselor(email.toLowerCase(), fullName, phone);
    } catch (err) {
      console.error('[CHECK-LOGIN] Counselor check failed:', err.message);
    }

    if (isCounselorUser) {
      return res.json({
        success: true,
        scenario: 'counselor',
        matches: [],
        activeRecord: null,
      });
    }

    const matches = await searchDuplicates(email, phone);
    console.log('[CHECK-LOGIN] searchDuplicates returned:', JSON.stringify(matches));

    // Filter to ONLY Active records — inactive are invisible to non-staff
    const safeMatches = matches
      .filter((m) => (m.status || 'Active') === 'Active')
      .map((m) => ({
        uniqueId: m.uniqueId,
        fullName: m.fullName,
        email: m.email,
        phone: m.phone,
        status: 'Active',
        _matchedBy: m._matchedBy || [],
        createdAt: m.createdAt,
      }));

    // ── Analyze scenario (only Active records) ──
    let scenario = 'no_match';
    let activeRecord = null;

    if (safeMatches.length === 0) {
      scenario = 'no_match';
    } else if (safeMatches.length === 1) {
      scenario = 'single_active';
      activeRecord = safeMatches[0];
    } else {
      scenario = 'conflict';
    }

    res.json({
      success: true,
      scenario,
      matches: safeMatches,
      activeRecord,
    });
  } catch (err) {
    next(err);
  }
}

async function requestOTP(req, res, next) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    if (!checkOtpRateLimit(email)) {
      return res.status(429).json({ success: false, error: 'Too many OTP requests. Please wait a few minutes.' });
    }

    const otp = otpService.createAndStore(email);
    await emailService.sendOTPEmail(email, otp);

    res.json({ success: true, message: 'OTP sent to your email', bypassed: true, code: otp });
  } catch (err) {
    next(err);
  }
}

async function verifyOTP(req, res, next) {
  try {
    const { email, code, fullName, phone } = req.body;
    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'Email and code are required' });
    }

    const result = otpService.verifyOTP(email, code);
    if (!result.valid) {
      return res.status(401).json({ success: false, error: result.reason });
    }

    // Check counselor status — pass fullName + phone so GAS can validate fully
    let isCounselorFlag = false;
    try {
      isCounselorFlag = await checkCounselor(email.toLowerCase(), fullName, phone);
      console.log(`[AUTH] Counselor check for ${email}: ${isCounselorFlag}`);
    } catch (err) {
      console.error('[AUTH] Counselor check FAILED:', err.message);
    }

    // Set session
    req.session.authenticated = true;
    req.session.email = email.toLowerCase();
    req.session.isCounselor = isCounselorFlag;
    delete req.session.uniqueId;

    res.json({
      success: true,
      message: 'Verified successfully',
      email: email.toLowerCase(),
      isCounselor: isCounselorFlag,
    });
  } catch (err) {
    next(err);
  }
}

async function checkSession(req, res) {
  if (req.session && req.session.authenticated) {
    res.json({
      success: true,
      authenticated: true,
      email: req.session.email,
      uniqueId: req.session.uniqueId || null,
      isCounselor: req.session.isCounselor || false,
    });
  } else {
    res.json({ success: true, authenticated: false });
  }
}

async function logout(req, res) {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Failed to logout' });
    }
    res.json({ success: true, message: 'Logged out' });
  });
}

async function qrLogin(req, res, next) {
  try {
    const { email } = req.body;
    const cleanEmail = (email && email.trim()) ? email.trim().toLowerCase() : '';

    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    req.session.authenticated = true;
    req.session.email = cleanEmail;
    req.session.isCounselor = false;
    delete req.session.uniqueId;

    res.json({ success: true, email: cleanEmail });
  } catch (err) {
    next(err);
  }
}

module.exports = { requestOTP, verifyOTP, checkSession, logout, qrLogin, checkLogin };

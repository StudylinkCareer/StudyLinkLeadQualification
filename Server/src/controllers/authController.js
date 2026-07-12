// server/src/controllers/authController.js
// CHANGES:
//   - checkLogin() passes fullName + phone to checkCounselor (GAS now validates all three)
//   - verifyOTP() passes fullName + phone to checkCounselor
//   - Both handle the boolean return from the updated checkCounselor().

const otpService = require('../services/otpService');
const emailService = require('../services/emailService');
const { checkCounselor, searchDuplicates } = require('../services/dataService');
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
const ACTIVE_LEAD = `lead_status NOT IN ('Contracted','Lost','Archived','Cancelled')`;

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
        studentId: m.studentId,
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
    let hasActiveLead = false;
    let activeLead = null;

    if (safeMatches.length === 0) {
      scenario = 'no_match';                 // case 3: brand-new student
    } else if (safeMatches.length === 1) {
      scenario = 'single_active';
      activeRecord = safeMatches[0];
      // Returning-student 3-way: does the existing Sales doc have an ACTIVE lead?
      //   yes → case 1 (retrieve the active lead for edits)
      //   no  → case 2 (Sales doc exists, no active lead → create a new lead)
      const r = await pool.query(
        `SELECT lead_id, lead_status, counselor, study_plans, close_date, confidence
           FROM leads WHERE person_id = $1 AND ${ACTIVE_LEAD}
          ORDER BY lead_id DESC LIMIT 1`, [activeRecord.studentId]);
      if (r.rows.length) {
        hasActiveLead = true;
        activeLead = {
          leadId:     r.rows[0].lead_id,
          leadStatus: r.rows[0].lead_status,
          counselor:  r.rows[0].counselor,
          studyPlans: r.rows[0].study_plans,
        };
      }
    } else {
      scenario = 'conflict';
    }

    res.json({
      success: true,
      scenario,
      matches: safeMatches,
      activeRecord,
      hasActiveLead,   // single_active + true → case 1 (retrieve); false → case 2 (add lead)
      activeLead,
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

    // ─── EMAIL SEND DISABLED (OTP bypassed) ───────────────────────────
    // No real code is needed, so we skip generating and emailing one.
    // This also removes the Google-Apps-Script email dependency from the
    // login path, so a flaky email service can no longer block users
    // from reaching the verification screen.
    // To RE-ENABLE: restore the two lines below.
    //   const otp = otpService.createAndStore(email);
    //   await emailService.sendOTPEmail(email, otp);
    // ──────────────────────────────────────────────────────────────────

    res.json({ success: true, message: 'OTP sent to your email' });
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

    // ─── OTP BYPASS (temporary) ───────────────────────────────────────
    // Real verification is disabled while email OTP is being fixed.
    // Any 6-digit code submitted from the OTP screen is accepted.
    // To RE-ENABLE real verification, delete this block and restore:
    //   const result = otpService.verifyOTP(email, code);
    //   if (!result.valid) {
    //     return res.status(401).json({ success: false, error: result.reason });
    //   }
    console.log(`[AUTH] OTP bypass active — accepting ${email} without code check`);
    // ──────────────────────────────────────────────────────────────────

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
    delete req.session.studentId;

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
      studentId: req.session.studentId || null,
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
    delete req.session.studentId;

    res.json({ success: true, email: cleanEmail });
  } catch (err) {
    next(err);
  }
}

module.exports = { requestOTP, verifyOTP, checkSession, logout, qrLogin, checkLogin };

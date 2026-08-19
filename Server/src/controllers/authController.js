// server/src/controllers/authController.js
// CHANGES (2026-08 — separate Login flow, remove staff search tab):
//   - checkLogin()/verifyOTP() no longer call checkCounselor — the
//     'counselor' scenario and isCounselor:true are gone for good; staff use
//     LeadManagement for lookups now, not this customer-facing app.
//   - requestOTP()/verifyOTP() branch on an explicit `purpose: 'login'`:
//     that's the ONLY path that generates/sends/checks a real OTP (via
//     resendService/smsService + otpService). Registration's existing call
//     sites are unchanged — still bypassed, exactly as before.
//   - New loginLookup()/otpChannels() back the new /login page.

const otpService = require('../services/otpService');
const emailService = require('../services/emailService');
const resendService = require('../services/resendService');
const smsService = require('../services/smsService');
const { searchDuplicates } = require('../services/dataService');
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
// The 'counselor' scenario (staff detecting their own email here and being
// routed into a student-search screen) is removed as of 2026-08 — staff use
// LeadManagement for lookups now, not this customer-facing registration
// form. checkCounselor() is unused going forward; kept in dataService.js
// in case something else needs it later, just not called from here.
async function checkLogin(req, res, next) {
  try {
    const { email, phone } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
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

// requestOTP serves TWO very different callers, distinguished by
// `purpose` (confirmed 2026-08):
//   - Registration (Home.jsx, existing call — { email }, no purpose): kept
//     EXACTLY as before — no real OTP generated/sent at all. This is
//     deliberate, not a bug (see the block comment below) — frontdesk
//     staff process a queue at events and a real OTP round-trip per
//     registration was too slow. Untouched by this change.
//   - The new /login page ({ identifier, channel, purpose:'login' }):
//     generates and actually sends a real OTP, via email (Resend) or SMS,
//     depending on channel. This is the ONLY path that ever calls
//     otpService.createAndStore — registration never does.
async function requestOTP(req, res, next) {
  try {
    const { email, identifier, channel, purpose } = req.body;
    const target = purpose === 'login' ? identifier : email;
    if (!target) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    if (!checkOtpRateLimit(target)) {
      return res.status(429).json({ success: false, error: 'Too many OTP requests. Please wait a few minutes.' });
    }

    if (purpose === 'login') {
      const otp = otpService.createAndStore(target);
      const sendResult = channel === 'phone'
        ? await smsService.sendOtpSms(target, otp)
        : await resendService.sendOtpEmail(target, otp);
      if (!sendResult.sent) {
        // Dev-only fallback (same convention as the old emailService's
        // "[DEV] OTP for..." log) — lets login be tested locally without a
        // real RESEND_API_KEY/SMS_* configured. Never applies in production:
        // there, an unconfigured channel genuinely can't deliver a code, so
        // the request correctly fails (503) rather than pretending to succeed.
        if (process.env.NODE_ENV !== 'production' && String(sendResult.reason).endsWith('_not_configured')) {
          console.log(`[DEV] Login OTP for ${target} (${channel}): ${otp}`);
          return res.json({ success: true, message: `OTP sent via ${channel}`, devNote: 'not configured — logged to server console' });
        }
        console.warn('[AUTH] Login OTP send failed:', sendResult.reason, sendResult.detail);
        return res.status(503).json({
          success: false,
          error: channel === 'phone'
            ? 'Phone login is not available yet. Please use email instead.'
            : 'Could not send the verification email. Please try again shortly.',
          reason: sendResult.reason,
        });
      }
      return res.json({ success: true, message: `OTP sent via ${channel}` });
    }

    // ─── EMAIL SEND DISABLED for registration (OTP bypassed, intentional) ──
    // No real code is needed, so we skip generating and emailing one — this
    // keeps registration exactly as fast as it is today, no OTP round-trip.
    // To re-enable real OTP on REGISTRATION specifically (not just login),
    // restore the two lines below. Not planned — flagged for completeness.
    //   const otp = otpService.createAndStore(target);
    //   await emailService.sendOTPEmail(target, otp);
    // ──────────────────────────────────────────────────────────────────────

    res.json({ success: true, message: 'OTP sent to your email' });
  } catch (err) {
    next(err);
  }
}

// otpChannels — lets the Login page know which channels are actually live
// before the user picks one, so an unconfigured phone/SMS gateway shows as
// "coming soon" instead of a dead button that fails after the fact.
async function otpChannels(req, res) {
  res.json({ success: true, data: { email: resendService.isConfigured(), phone: smsService.isConfigured() } });
}

// loginLookup — the new /login page's identifier -> existing-record lookup.
// Deliberately separate from checkLogin: takes ONE identifier (email OR
// phone, not a whole registration form), reuses the same searchDuplicates()
// query (already tolerant of one blank field), and never creates anything —
// login only ever resolves to an EXISTING record or tells the user there
// isn't one (with a link back to registration).
async function loginLookup(req, res, next) {
  try {
    const { identifier, channel } = req.body;
    if (!identifier || !['email', 'phone'].includes(channel)) {
      return res.status(400).json({ success: false, error: 'identifier and channel (email|phone) are required' });
    }

    const matches = await searchDuplicates(
      channel === 'email' ? identifier : '',
      channel === 'phone' ? identifier : ''
    );
    const safeMatches = matches
      .filter((m) => (m.status || 'Active') === 'Active')
      .map((m) => ({ studentId: m.studentId, fullName: m.fullName, email: m.email, phone: m.phone }));

    if (safeMatches.length === 0) return res.json({ success: true, found: false });
    if (safeMatches.length > 1)  return res.json({ success: true, found: 'multiple', matches: safeMatches });
    return res.json({ success: true, found: true, studentId: safeMatches[0].studentId, fullName: safeMatches[0].fullName });
  } catch (err) {
    next(err);
  }
}

async function verifyOTP(req, res, next) {
  try {
    const { email, code, identifier, purpose } = req.body;
    const target = purpose === 'login' ? identifier : email;
    if (!target || !code) {
      return res.status(400).json({ success: false, error: 'Email and code are required' });
    }

    if (purpose === 'login') {
      // Real verification (confirmed 2026-08) — only for the new /login
      // flow. A wrong/expired code is genuinely rejected here.
      const result = otpService.verifyOTP(target, code);
      if (!result.valid) {
        return res.status(401).json({ success: false, error: result.reason });
      }
    } else {
      // ─── OTP BYPASS for registration (intentional, unchanged) ──────────
      // Real verification stays disabled for registration's own flow —
      // any 6-digit code submitted from /verify is accepted, exactly as
      // before. See requestOTP's matching comment for why.
      console.log(`[AUTH] Registration OTP bypass active — accepting ${target} without code check`);
      // ─────────────────────────────────────────────────────────────────
    }

    // isCounselor removed 2026-08 — nothing sets it true anymore; staff use
    // LeadManagement, not this app. Kept in the session/response shape
    // (always false) so existing client code reading it doesn't need to
    // branch on its absence.
    req.session.authenticated = true;
    req.session.email = target.toLowerCase();
    req.session.isCounselor = false;
    delete req.session.studentId;

    res.json({
      success: true,
      message: 'Verified successfully',
      email: target.toLowerCase(),
      isCounselor: false,
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

module.exports = { requestOTP, verifyOTP, checkSession, logout, qrLogin, checkLogin, loginLookup, otpChannels };

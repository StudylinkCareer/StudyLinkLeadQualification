// Server/src/services/smsService.js
// ---------------------------------------------------------------------------
// Phone-number OTP delivery via a Vietnamese SMS Brandname gateway (confirmed
// 2026-08 — explicitly NOT Zalo ZNS, which was considered and ruled out in
// favor of plain SMS). WHICH gateway (eSMS.vn / SpeedSMS.vn / FPT SMS / etc.)
// is still an open choice — that's an account/contract decision, not a code
// one. This module is DORMANT until configured (same convention as
// resendService.js/zaloService.js): sendOtpSms() returns a structured
// { sent:false, reason:'sms_not_configured' } instead of throwing, and the
// Login page is expected to check isConfigured() (via the
// GET /api/auth/otp-channels endpoint) and show the phone tab as
// "coming soon" rather than let someone request a code that never arrives.
//
// The actual HTTP call below is a REASONABLE PLACEHOLDER SHAPE ONLY — most VN
// Brandname gateways take a similar { apiKey, brandname, phone, message } POST,
// but none has been verified against real docs yet. Once a specific provider
// is chosen, replace the body of sendOtpSms's fetch call with that provider's
// actual documented request/response shape — everything else (isConfigured,
// the dormant-until-set guard, the calling convention from authController.js)
// stays the same.
//
// Env (all read at call time, same pattern as resendService.js):
//   SMS_API_KEY     - required to send
//   SMS_API_URL     - the gateway's send endpoint
//   SMS_SENDER_ID   - the registered Brandname sender
// ---------------------------------------------------------------------------

function cfg() {
  return {
    apiKey:   (process.env.SMS_API_KEY || '').trim(),
    apiUrl:   (process.env.SMS_API_URL || '').trim(),
    senderId: (process.env.SMS_SENDER_ID || 'StudyLink').trim(),
  };
}

function isConfigured() {
  const c = cfg();
  return Boolean(c.apiKey && c.apiUrl);
}

// Very loose VN phone normalization (accepts 0xxxxxxxxx or 84xxxxxxxxx or
// +84xxxxxxxxx) — mirrors zaloService.js's normalizeVnPhone so both channels
// agree on what a "valid enough" VN number looks like.
function normalizeVnPhone(raw) {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  if (digits.startsWith('84')) return digits;
  if (digits.startsWith('0')) return '84' + digits.slice(1);
  return digits;
}

// Never throws — returns a structured result like the other senders.
async function sendOtpSms(phone, otp) {
  const c = cfg();
  if (!c.apiKey || !c.apiUrl) {
    return { sent: false, reason: 'sms_not_configured', detail: 'SMS_API_KEY/SMS_API_URL are not set; phone login is not live yet.' };
  }
  const normalized = normalizeVnPhone(phone);
  if (!normalized || normalized.length < 10) {
    return { sent: false, reason: 'bad_phone', detail: `Unusable phone number: ${phone}` };
  }

  const message = `${otp} la ma xac thuc StudyLink cua ban. Ma co hieu luc trong 10 phut.`;

  try {
    const res = await fetch(c.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: c.apiKey,
        brandname: c.senderId,
        phone: normalized,
        message,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      return { sent: true, to: normalized, raw: data };
    }
    return { sent: false, reason: 'sms_api_error', detail: `SMS gateway HTTP ${res.status}`, raw: data };
  } catch (err) {
    return { sent: false, reason: 'network_error', detail: err.message };
  }
}

module.exports = { sendOtpSms, isConfigured, normalizeVnPhone, cfg };

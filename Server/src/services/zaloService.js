// C:/Users/rhod_/Documents/StudyLinkLeadQualification/Server/src/services/zaloService.js
// ---------------------------------------------------------------------
// Zalo sender for event badges. Mirrors emailService.sendEventQrEmail, but
// delivers the badge + "complete your profile" link over Zalo instead of
// email. Two delivery mechanisms are supported; the active one is chosen by
// env config at wiring time:
//
//   1. ZNS (Zalo Notification Service) - sends a pre-approved TEMPLATE to a
//      PHONE NUMBER. Works even if the recipient does NOT follow your OA.
//      This is the closest mirror of email (you push to a contact you hold).
//
//   2. OA message - sends a free-form message to a Zalo USER_ID, but ONLY
//      reaches people who already follow your Official Account (or are inside
//      a 48h interaction window). Useful once you capture follower user_ids.
//
// IMPORTANT: every send goes THROUGH an Official Account and needs an OA
// access token. Until ZALO_OA_ACCESS_TOKEN is set in the environment, this
// service is DORMANT: sendEventBadge() returns { sent:false, reason:
// 'zalo_not_configured' } and makes no network call. That lets the route and
// button ship now and "go live" the moment the OA piece is sorted - no code
// change, just env vars.
// ---------------------------------------------------------------------

const tokenManager = require('./zaloTokenManager');

// ---- Config (all read at call time so Railway env changes take effect on
// the next request without a code change) -----------------------------------
function cfg() {
  return {
    // The OA access token. For now this is a value you paste into Railway.
    // LATER (wiring): replace getOaAccessToken() below with a refresh-token
    // manager, because OA access tokens expire (~1 hour).
    oaAccessToken: (process.env.ZALO_OA_ACCESS_TOKEN || '').trim(),
    // The approved ZNS template id (only needed for the ZNS path).
    znsTemplateId: (process.env.ZALO_ZNS_TEMPLATE_ID || '').trim(),
    // The approved ZNS template id for the questionnaire-evaluation (stone)
    // message. Separate template, separate approval. Until it is set the
    // stone-result Zalo send is DORMANT (same pattern as the badge send).
    znsResultTemplateId: (process.env.ZALO_ZNS_RESULT_TEMPLATE_ID || '').trim(),
    // Which mechanism to use: 'zns' or 'oa'. Defaults to 'zns'.
    method: (process.env.ZALO_SEND_METHOD || 'zns').trim().toLowerCase(),
  };
}

// Returns a valid OA access token via the auto-refresh manager (DB-persisted,
// rotates the refresh token). Falls back to the raw env token if the manager is
// unavailable (e.g. zalo_oauth_tokens not migrated yet) so dev sends still work.
async function getOaAccessToken() {
  try {
    const t = await tokenManager.getAccessToken();
    if (t) return t;
  } catch (e) {
    console.warn('[zalo] token manager unavailable, using env token:', e.message);
  }
  return cfg().oaAccessToken;
}

// True only if we have enough config to actually send.
function isConfigured(method) {
  const c = cfg();
  if (!c.oaAccessToken) return false;
  const m = method || c.method;
  if (m === 'zns' && !c.znsTemplateId) return false;
  return true;
}

// A small status helper - handy for a debug route or a startup log.
function getStatus() {
  const c = cfg();
  return {
    method: c.method,
    hasOaToken: Boolean(c.oaAccessToken),
    hasZnsTemplate: Boolean(c.znsTemplateId),
    configured: isConfigured(),
  };
}

// Normalize a Vietnamese phone to ZNS format: country code 84, no '+',
// no leading 0, digits only. e.g. "090 987 7477" -> "84909877477".
function normalizeVnPhone(raw) {
  let s = String(raw || '').replace(/[^\d+]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('0')) s = '84' + s.slice(1);
  if (!s.startsWith('84')) s = '84' + s;
  return s;
}

// Translate Zalo's cryptic ZNS error codes into a clear reason staff can act on.
// (Confirmed empirically: sending a ZNS to a number that is NOT a Zalo user
//  returns error -110 "Zalo version unsupported" — not an actual version issue.)
function friendlyZnsFailure(data) {
  const code = String((data && data.error) != null ? data.error : '');
  const msg  = (data && data.message) || '';
  const MAP = {
    '-110': 'Not a reachable Zalo user (number not on Zalo, or app not installed / too old)',
    '-124': 'Zalo access token invalid',
    '-136': 'Zalo app/OA association required',
  };
  return MAP[code] || msg || 'Zalo could not deliver';
}

// ---- ZNS path: send a template to a phone number ---------------------------
async function sendBadgeViaZns({ phone, name, eventName, registrationCode, token }) {
  const c = cfg();
  const to = normalizeVnPhone(phone);
  if (!to || to.length < 9) {
    return { sent: false, reason: 'bad_phone', detail: `Unusable phone: ${phone}` };
  }

  // template_data keys MUST match the parameter names defined in the approved
  // ZNS template (template id c.znsTemplateId). These are the four blanks in the
  // StudyLink "Event Badge" template:
  //   customer_name     - recipient's name                     [title greeting]
  //   event_name        - event title                          [table row]
  //   registration_code - the student's Sales ID (the "Mã đăng ký" identifier
  //                       that satisfies Zalo's transaction-reference rule)
  //   token             - the attendance token; the template's "View Badge"
  //                       button URL is fixed as
  //                       https://slcareerguidance.netlify.app/profile?t=<token>
  //                       so we pass ONLY the token here, not the whole URL.
  const body = {
    phone: to,
    template_id: c.znsTemplateId,
    template_data: {
      customer_name: name || '',
      event_name: eventName || '',
      registration_code: registrationCode || '',
      token: token || '',
    },
    // "badge_<studentId>_<ts>" — the delivery webhook (routes/zaloWebhook.js)
    // parses the studentId back out as a fallback match when a payload
    // variant doesn't carry msg_id.
    tracking_id: `badge_${registrationCode || 'x'}_${Date.now()}`,
  };

  const post = async (accessToken) => {
    const res = await fetch('https://business.openapi.zalo.me/message/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', access_token: accessToken },
      body: JSON.stringify(body),
    });
    return res.json().catch(() => ({}));
  };

  try {
    let data = await post(await getOaAccessToken());
    // Auto-heal: -124 = the access token was invalidated (common after a re-mint).
    // Force a fresh token (DB refresh token, then env refresh token) and retry once.
    if (data && data.error === -124) {
      try {
        const fresh = await tokenManager.forceRefresh();
        data = await post(fresh);
      } catch (e) {
        return { sent: false, reason: 'token_refresh_failed', detail: e.message, raw: data };
      }
    }
    // Zalo returns { error: 0, message: 'Success', ... } on success.
    if (data && data.error === 0) {
      return { sent: true, via: 'zns', to, raw: data };
    }
    return { sent: false, reason: 'zalo_api_error', detail: friendlyZnsFailure(data), raw: data };
  } catch (err) {
    return { sent: false, reason: 'network_error', detail: err.message };
  }
}

// ---- OA path: send a message to a Zalo user_id (followers only) -------------
async function sendBadgeViaOa({ zaloUserId, name, eventName, profileUrl }) {
  if (!zaloUserId) {
    return { sent: false, reason: 'no_user_id', detail: 'OA send needs a zalo_user_id' };
  }

  // Free-form CS (customer service) message. The exact attachment schema for
  // buttons gets finalized at wiring; a plain text + link is the safe baseline
  // and always renders.
  const text = [
    name ? `Hi ${name},` : 'Hi,',
    eventName ? `your badge for ${eventName} is ready.` : 'your event badge is ready.',
    profileUrl ? `View it and complete your profile: ${profileUrl}` : '',
  ].filter(Boolean).join(' ');

  const body = {
    recipient: { user_id: zaloUserId },
    message: { text },
  };

  try {
    const res = await fetch('https://openapi.zalo.me/v3.0/oa/message/cs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        access_token: await getOaAccessToken(),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.error === 0) {
      return { sent: true, via: 'oa', to: zaloUserId, raw: data };
    }
    return { sent: false, reason: 'zalo_api_error', detail: friendlyZnsFailure(data), raw: data };
  } catch (err) {
    return { sent: false, reason: 'network_error', detail: err.message };
  }
}

// ---- Public entry point -----------------------------------------------------
// Pick the mechanism (explicit `method`, else env default). Returns
//   { sent: true, via, to, ... }                  on success
//   { sent: false, reason, detail }               otherwise
// The route should stamp badge_zalo_sent_at ONLY when sent === true.
async function sendEventBadge({ method, phone, zaloUserId, name = '', eventName = '', profileUrl = '', registrationCode = '', token = '' } = {}) {
  const m = (method || cfg().method || 'zns').toLowerCase();

  if (!isConfigured(m)) {
    return {
      sent: false,
      reason: 'zalo_not_configured',
      detail: 'Zalo sending is not set up yet (no OA access token / template). '
            + 'The badge was not sent via Zalo.',
    };
  }

  if (m === 'oa') {
    // OA free-form message still uses the whole profile URL inline.
    return sendBadgeViaOa({ zaloUserId, name, eventName, profileUrl });
  }
  // ZNS uses the template's own button URL, so it needs the token + the
  // registration code (Sales ID), not the assembled profileUrl.
  return sendBadgeViaZns({ phone, name, eventName, registrationCode, token });
}

// ---- Stone result (questionnaire evaluation) --------------------------------
// Send the student their stone evaluation after they submit the "Know you
// better" questionnaire. Mirrors sendEventBadge:
//   * ZNS path — pre-approved template ZALO_ZNS_RESULT_TEMPLATE_ID with params
//       customer_name, event_name, stone_name, registration_code, token
//     (the template's own button URL points at /profile?t=<token>, which now
//     shows the stone). DORMANT until that template id is configured.
//   * OA path  — free-form text with the stone label + full banner message
//     (followers / 48h window only).
async function sendStoneResultViaZns({ phone, name, eventName, stoneLabel, registrationCode, token }) {
  const c = cfg();
  const to = normalizeVnPhone(phone);
  if (!to || to.length < 9) {
    return { sent: false, reason: 'bad_phone', detail: `Unusable phone: ${phone}` };
  }

  const body = {
    phone: to,
    template_id: c.znsResultTemplateId,
    template_data: {
      customer_name: name || '',
      event_name: eventName || '',
      stone_name: stoneLabel || '',
      registration_code: registrationCode || '',
      token: token || '',
    },
    // "result_<studentId>_<ts>" — same webhook-fallback convention as the badge.
    tracking_id: `result_${registrationCode || 'x'}_${Date.now()}`,
  };

  const post = async (accessToken) => {
    const res = await fetch('https://business.openapi.zalo.me/message/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', access_token: accessToken },
      body: JSON.stringify(body),
    });
    return res.json().catch(() => ({}));
  };

  try {
    let data = await post(await getOaAccessToken());
    if (data && data.error === -124) {
      try {
        const fresh = await tokenManager.forceRefresh();
        data = await post(fresh);
      } catch (e) {
        return { sent: false, reason: 'token_refresh_failed', detail: e.message, raw: data };
      }
    }
    if (data && data.error === 0) {
      return { sent: true, via: 'zns', to, raw: data };
    }
    return { sent: false, reason: 'zalo_api_error', detail: friendlyZnsFailure(data), raw: data };
  } catch (err) {
    return { sent: false, reason: 'network_error', detail: err.message };
  }
}

async function sendStoneResultViaOa({ zaloUserId, name, stoneLabel, stoneMessage, profileUrl }) {
  if (!zaloUserId) {
    return { sent: false, reason: 'no_user_id', detail: 'OA send needs a zalo_user_id' };
  }
  const text = [
    name ? `Chúc mừng ${name}!` : 'Chúc mừng bạn!',
    stoneLabel ? `Kết quả đánh giá của bạn: ${stoneLabel}.` : '',
    stoneMessage || '',
    'Cảm ơn bạn đã đăng ký tham dự triển lãm của chúng tôi – chúng tôi rất mong được đón tiếp bạn!',
    profileUrl ? `Xem thẻ tham dự mới của bạn: ${profileUrl}` : '',
  ].filter(Boolean).join(' ');

  try {
    const res = await fetch('https://openapi.zalo.me/v3.0/oa/message/cs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', access_token: await getOaAccessToken() },
      body: JSON.stringify({ recipient: { user_id: zaloUserId }, message: { text } }),
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.error === 0) {
      return { sent: true, via: 'oa', to: zaloUserId, raw: data };
    }
    return { sent: false, reason: 'zalo_api_error', detail: friendlyZnsFailure(data), raw: data };
  } catch (err) {
    return { sent: false, reason: 'network_error', detail: err.message };
  }
}

async function sendStoneResult({ method, phone, zaloUserId, name = '', eventName = '', stoneLabel = '', stoneMessage = '', profileUrl = '', registrationCode = '', token = '' } = {}) {
  const c = cfg();
  const m = (method || c.method || 'zns').toLowerCase();

  if (!c.oaAccessToken || (m === 'zns' && !c.znsResultTemplateId)) {
    return {
      sent: false,
      reason: 'zalo_not_configured',
      detail: 'Stone-result Zalo sending is not set up yet '
            + '(no OA access token, or ZALO_ZNS_RESULT_TEMPLATE_ID not configured).',
    };
  }

  if (m === 'oa') {
    return sendStoneResultViaOa({ zaloUserId, name, stoneLabel, stoneMessage, profileUrl });
  }
  return sendStoneResultViaZns({ phone, name, eventName, stoneLabel, registrationCode, token });
}

// ---- ZNS delivery-status PULL (Phase 2) ------------------------------------
// Zalo's US-IP geo-filter blocks the delivery WEBHOOK, so we PULL status by
// message id instead (an outbound call, which works from our server). Returns
// Zalo's raw response. Confirmed shape:
//   { error:0, data:{ status:1, message:"...delivered to the user's phone",
//                     delivery_time:"<ms epoch>" } }
// status === 1 (or a "delivered" message) means delivered.
async function getZnsMessageStatus(messageId) {
  const id = String(messageId || '').trim();
  if (!id) return { error: -1, message: 'no message_id' };
  try {
    const token = await getOaAccessToken();
    const url = `https://business.openapi.zalo.me/message/status?message_id=${encodeURIComponent(id)}`;
    const res = await fetch(url, { headers: { access_token: token } });
    return await res.json().catch(() => ({}));
  } catch (err) {
    return { error: -999, message: err.message };
  }
}

module.exports = {
  sendEventBadge,
  sendStoneResult,
  getZnsMessageStatus,
  isConfigured,
  getStatus,
  normalizeVnPhone,
};

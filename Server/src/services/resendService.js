// Server/src/services/resendService.js
// ---------------------------------------------------------------------------
// Email backup for the event follow-up (feature 3). Sends a StudyLink-branded
// HTML email that MIRRORS the approved Zalo survey template
// ("Khảo sát ý kiến sự kiện StudyLink - Chưa Tham Gia", 611671): same Vietnamese
// wording, the same "Bắt đầu khảo sát" button pointing at the same Google Form.
//
// Uses Resend (https://resend.com). DORMANT until env is set:
//   RESEND_API_KEY              - your Resend API key (required to send)
//   RESEND_FROM                 - verified sender, e.g. "StudyLink <events@studylink.org>"
//   EVENT_FOLLOWUP_SURVEY_URL   - the survey link (defaults to the no-show Google Form)
//
// All env is read at call time so a Railway/​.env change takes effect on the
// next send with no code change (same pattern as zaloService).
// ---------------------------------------------------------------------------

const DEFAULT_SURVEY_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSeWSG9anh1zbHskwg4XbJeEx9oEn76acTF5KbyBxIsfvFbniQ/viewform';

function cfg() {
  return {
    apiKey:    (process.env.RESEND_API_KEY || '').trim(),
    from:      (process.env.RESEND_FROM || 'StudyLink <info@studylink.org>').trim(),
    surveyUrl: (process.env.EVENT_FOLLOWUP_SURVEY_URL || DEFAULT_SURVEY_URL).trim(),
  };
}

function isConfigured() {
  return Boolean(cfg().apiKey);
}

// Minimal HTML-escape for values dropped into the template.
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Build the email-safe HTML (tables + inline styles), mirroring the Zalo card.
function buildFollowupHtml({ name, customerCode, eventName, eventDate, surveyUrl }) {
  const nameHtml  = esc(name) || 'bạn';
  const codeHtml  = esc(customerCode) || '—';
  const evtHtml   = esc(eventName) || 'sự kiện StudyLink';
  const dateHtml  = esc(eventDate);
  const evtLine   = dateHtml ? `${evtHtml} ngày ${dateHtml}` : evtHtml;

  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/></head>
<body style="margin:0;background:#eef1f6;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
    <tr><td style="padding:26px 30px 6px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle;padding-right:9px;"><div style="width:30px;height:30px;background:#c8102e;border-radius:6px;"></div></td>
        <td style="vertical-align:middle;">
          <div style="font-size:22px;font-weight:800;color:#111827;line-height:1;">StudyLink</div>
          <div style="font-size:10px;letter-spacing:2px;color:#c8102e;text-transform:uppercase;margin-top:2px;">Shaping your future</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:14px 30px 0;">
      <div style="font-size:19px;font-weight:800;color:#111827;">Xin chào ${nameHtml},</div>
    </td></tr>
    <tr><td style="padding:14px 30px 0;font-size:14.5px;line-height:1.65;color:#374151;">
      <p style="margin:0 0 14px;">Cảm ơn Bạn đã đăng ký tham dự sự kiện ${evtLine} cùng StudyLink, nhưng rất tiếc chưa có dịp gặp gỡ.</p>
      <p style="margin:0 0 14px;">Dù vậy, hành trình “bước ra thế giới” của bạn vẫn luôn có StudyLink đồng hành. Bạn hãy dành ra 1 phút chia sẻ 3 điều nhỏ này để StudyLink hỗ trợ hành trình du học dành riêng cho bạn ngay lúc này nhé!</p>
    </td></tr>
    <tr><td style="padding:6px 30px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;">
        <tr><td style="color:#6b7280;padding:5px 0;width:170px;">Mã xác nhận tham dự</td><td style="color:#111827;font-weight:700;">${codeHtml}</td></tr>
        <tr><td style="color:#6b7280;padding:5px 0;">Trạng thái</td><td style="color:#111827;font-weight:700;">Đã đăng ký thành công</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:22px 30px 30px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td align="center" bgcolor="#0068FF" style="border-radius:10px;">
          <a href="${esc(surveyUrl)}" style="display:block;padding:14px 20px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Bắt đầu khảo sát</a>
        </td>
      </tr></table>
    </td></tr>
  </table>
  <div style="max-width:480px;margin:14px auto 0;font-size:11px;color:#9ca3af;text-align:center;line-height:1.5;">
    StudyLink · Nếu nút không hoạt động, hãy mở liên kết: <a href="${esc(surveyUrl)}" style="color:#6b7280;">${esc(surveyUrl)}</a>
  </div>
</td></tr></table>
</body></html>`;
}

// Send the follow-up email via Resend. Returns { sent, reason?, detail?, id? }.
// Never throws — returns a structured result like the Zalo sender.
async function sendFollowupEmail(to, { name = '', customerCode = '', eventName = '', eventDate = '', surveyUrl } = {}) {
  const c = cfg();
  if (!c.apiKey) {
    return { sent: false, reason: 'resend_not_configured', detail: 'RESEND_API_KEY is not set; email backup was not sent.' };
  }
  const recipient = String(to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return { sent: false, reason: 'bad_email', detail: `Unusable email: ${to}` };
  }

  const html = buildFollowupHtml({
    name,
    customerCode,
    eventName,
    eventDate,
    surveyUrl: surveyUrl || c.surveyUrl,
  });

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({
        from: c.from,
        to: [recipient],
        subject: 'StudyLink — Dành 1 phút chia sẻ để chúng tôi hỗ trợ bạn nhé',
        html,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data && data.id) {
      return { sent: true, id: data.id, to: recipient };
    }
    const detail = (data && (data.message || (data.error && data.error.message))) || `Resend HTTP ${res.status}`;
    return { sent: false, reason: 'resend_api_error', detail, raw: data };
  } catch (err) {
    return { sent: false, reason: 'network_error', detail: err.message };
  }
}

module.exports = { sendFollowupEmail, isConfigured, cfg };

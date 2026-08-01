// Server/src/services/budgetApprovalEmail.js
// ---------------------------------------------------------------------------
// Sends the budget-approval PDF to marketing + accounting when mom clicks
// Duyệt. Mirrors resendService.js exactly: raw fetch to the Resend API
// (not the `resend` SDK package), DORMANT until RESEND_API_KEY is set,
// never throws — returns a structured { sent, reason?, detail? } like every
// other send-result in this codebase, so approval can succeed even if the
// email fails (the DB stamp is the source of truth, not the email).
//
// Env:
//   RESEND_API_KEY               - shared with resendService.js
//   RESEND_FROM                  - shared with resendService.js
//   BUDGET_APPROVAL_NOTIFY_EMAILS - comma-separated recipients, defaults to
//                                   marketing@studylink.org,tri.vo@studylink.org
//   (both configurable because the requirement itself says the accountant's
//   address is only "currently" tri.vo@studylink.org)
// ---------------------------------------------------------------------------

const DEFAULT_RECIPIENTS = 'marketing@studylink.org,tri.vo@studylink.org';

function cfg() {
  return {
    apiKey: (process.env.RESEND_API_KEY || '').trim(),
    from: (process.env.RESEND_FROM || 'StudyLink <info@studylink.org>').trim(),
    recipients: (process.env.BUDGET_APPROVAL_NOTIFY_EMAILS || DEFAULT_RECIPIENTS)
      .split(',').map((s) => s.trim()).filter(Boolean),
  };
}

function isConfigured() {
  return Boolean(cfg().apiKey);
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const BUDGET_TYPE_LABEL = { planned: 'Kế hoạch', actual: 'Thực tế' };

function buildHtml({ eventName, budgetType, approvedBy, approvedAt, total }) {
  const typeLabel = BUDGET_TYPE_LABEL[budgetType] || budgetType;
  const totalFmt = total != null ? Number(total).toLocaleString('vi-VN') + ' đ' : '—';
  const dateFmt = approvedAt ? new Date(approvedAt).toLocaleDateString('vi-VN') : '—';
  return `<!DOCTYPE html>
<html lang="vi"><body style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;">
<p>Ngân sách <strong>${esc(typeLabel)}</strong> của sự kiện <strong>${esc(eventName)}</strong> đã được duyệt.</p>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px;">
<tr><td style="color:#6b7280;">Duyệt bởi</td><td style="font-weight:700;">${esc(approvedBy)}</td></tr>
<tr><td style="color:#6b7280;">Ngày duyệt</td><td style="font-weight:700;">${esc(dateFmt)}</td></tr>
<tr><td style="color:#6b7280;">Tổng ngân sách</td><td style="font-weight:700;">${esc(totalFmt)}</td></tr>
</table>
<p>File PDF chi tiết đính kèm trong email này.</p>
</body></html>`;
}

// Never throws — returns { sent, reason?, detail?, id? }.
async function sendBudgetApprovalEmail({ eventName, budgetType, approvedBy, approvedAt, total, pdfBuffer, pdfFilename }) {
  const c = cfg();
  if (!c.apiKey) {
    return { sent: false, reason: 'resend_not_configured', detail: 'RESEND_API_KEY is not set; approval email was not sent.' };
  }
  if (!c.recipients.length) {
    return { sent: false, reason: 'no_recipients', detail: 'BUDGET_APPROVAL_NOTIFY_EMAILS resolved to an empty list.' };
  }

  const typeLabel = BUDGET_TYPE_LABEL[budgetType] || budgetType;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({
        from: c.from,
        to: c.recipients,
        subject: `StudyLink — Ngân sách ${typeLabel} đã duyệt: ${eventName}`,
        html: buildHtml({ eventName, budgetType, approvedBy, approvedAt, total }),
        attachments: [
          {
            filename: pdfFilename || 'ngan-sach.pdf',
            content: pdfBuffer.toString('base64'),
          },
        ],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data && data.id) {
      return { sent: true, id: data.id, to: c.recipients };
    }
    const detail = (data && (data.message || (data.error && data.error.message))) || `Resend HTTP ${res.status}`;
    return { sent: false, reason: 'resend_api_error', detail, raw: data };
  } catch (err) {
    return { sent: false, reason: 'network_error', detail: err.message };
  }
}

module.exports = { sendBudgetApprovalEmail, isConfigured, cfg };

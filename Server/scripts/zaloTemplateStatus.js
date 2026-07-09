// Server/scripts/zaloTemplateStatus.js
// ---------------------------------------------------------------------------
// Checks the approval status of a ZNS template via the Zalo Business API,
// using the auto-refresh token manager. Run it anytime to see whether Zalo
// has approved the badge template yet.
//
//   node scripts/zaloTemplateStatus.js            (uses ZALO_ZNS_TEMPLATE_ID)
//   node scripts/zaloTemplateStatus.js 601036     (or pass an id explicitly)
//
// Status values you'll see:
//   ENABLE          -> APPROVED & active (ready to send) ✅
//   PENDING_REVIEW  -> still waiting on Zalo ⏳
//   REJECT          -> rejected (a reason is usually included) ❌
// ---------------------------------------------------------------------------

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const tm = require('../src/services/zaloTokenManager');

(async () => {
  const templateId = (process.argv[2] || process.env.ZALO_ZNS_TEMPLATE_ID || '').trim();
  if (!templateId) {
    console.error('No template id. Pass one or set ZALO_ZNS_TEMPLATE_ID in .env.');
    process.exit(1);
  }

  const token = await tm.getAccessToken();
  const url = `https://business.openapi.zalo.me/template/info/v2?template_id=${encodeURIComponent(templateId)}`;
  const res = await fetch(url, { headers: { access_token: token } });
  const data = await res.json().catch(() => ({}));

  if (data && data.error === 0 && data.data) {
    const d = data.data;
    const status = d.status || '(unknown)';
    const friendly =
      status === 'ENABLE'         ? 'APPROVED & active ✅ — ready to send'
      : status === 'PENDING_REVIEW' ? 'still pending Zalo review ⏳'
      : status === 'REJECT'         ? 'REJECTED ❌ — see reason below'
      : status;
    console.log(`Template ${templateId} (${d.templateName || d.template_name || ''}): ${friendly}`);
    console.log('\nFull details:\n' + JSON.stringify(d, null, 2));
    process.exit(0);
  }

  console.error('Status check failed:', JSON.stringify(data));
  process.exit(1);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });

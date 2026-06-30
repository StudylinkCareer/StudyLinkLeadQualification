// Server/scripts/zaloTest.js
// ---------------------------------------------------------------------------
// Fire a single test "event badge" through the dormant zaloService, using
// whatever is configured in Server/.env. Prints the config status first, then
// the send result, so you can see exactly why a send did/didn't go through.
//
//   ZNS (template -> phone):   node scripts/zaloTest.js <phone>
//   OA message (-> follower):  node scripts/zaloTest.js --oa <zalo_user_id>
//
// Needs in Server/.env: ZALO_OA_ACCESS_TOKEN (+ ZALO_ZNS_TEMPLATE_ID for ZNS),
// ZALO_SEND_METHOD=zns|oa. For ZNS pre-approval, send to a REGISTERED TEST PHONE.
// ---------------------------------------------------------------------------

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const zalo = require('../src/services/zaloService');

(async () => {
  console.log('Zalo status:', JSON.stringify(zalo.getStatus()));

  const args = process.argv.slice(2);
  const isOa = args[0] === '--oa';
  const target = isOa ? args[1] : args[0];
  if (!target) {
    console.error('Usage:\n  node scripts/zaloTest.js <phone>\n  node scripts/zaloTest.js --oa <zalo_user_id>');
    process.exit(1);
  }

  const token = 'TEST-TOKEN';
  const profileUrl = `https://slcareerguidance.netlify.app/profile?t=${token}`;
  console.log(`Sending ${isOa ? 'OA message' : 'ZNS'} to ${target} ...`);

  const result = await zalo.sendEventBadge({
    method:           isOa ? 'oa' : 'zns',
    phone:            isOa ? undefined : target,
    zaloUserId:       isOa ? target : undefined,
    name:             'Test Recipient',
    eventName:        'StudyLink Test Event',
    profileUrl,                       // OA path
    registrationCode: 'SL-TEST-0001', // ZNS "Mã đăng ký"
    token,                            // ZNS button: /profile?t=<token>
  });

  console.log('\nResult:', JSON.stringify(result, null, 2));
  process.exit(result.sent ? 0 : 1);
})();

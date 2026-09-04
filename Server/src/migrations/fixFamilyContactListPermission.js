// Fixes: parent (mother/father) phone/email couldn't be found via the Leads
// list search bar for ANY role, even the record's own owner — reported
// 2026-09 ("nhập Số điện thoại hoặc Email của phụ huynh vào thanh search thì
// không tìm ra Lead, số điện thoại học sinh thì ra").
//
// Root cause: role_field_permissions had motherPhone/fatherPhone/
// motherEmail/fatherEmail's LIST-context permission seeded as 'none' for
// EVERY single role (27/27) — applyFieldPermissions() drops a 'none' field
// from the response entirely (no masked value, no `_raw_<field>` either),
// so the Leads list search — which only searches whatever keys are actually
// present on each row it gets back — had nothing to search for these four
// fields, for anyone, regardless of ownership. The student's OWN phone/
// email (field_name 'phone'/'email') use 'view_masked' at list level
// instead, same as every other contact field on the page: shown masked in
// the list, full value carried alongside under `_raw_phone`/`_raw_email`
// for search to use. This just brings the four family-contact fields in
// line with that same, already-standard pattern — was very likely an
// oversight from whichever migration first seeded Family Contacts into the
// RBAC catalog (unify_column_metadata.js), not a deliberate stricter policy
// (detail-page permission for these fields is 'view_masked'/'edit' just
// like every other contact field — only list-search was ever fully blocked).
//
// Only touches list_permission; detail_permission (already view_masked/edit
// per role, same as phone/email) is untouched.
//
// Idempotent (WHERE list_permission = 'none' — re-running is a no-op once
// applied). Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/fixFamilyContactListPermission.js
//   PROD: node src/migrations/fixFamilyContactListPermission.js --allow-remote
require('dotenv').config();
const { Pool } = require('pg');

const url  = process.env.DATABASE_URL || '';
const host = (url.split('@')[1] || '').split('/')[0] || '(unknown)';
const isLocal     = /localhost|127\.0\.0\.1|studylink_dev/.test(url);
const allowRemote = process.argv.includes('--allow-remote');

if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!isLocal && !allowRemote) {
  console.error(`Refusing to run against non-local DB (${host}) without --allow-remote`);
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

(async () => {
  console.log('Target DB host: ' + host);

  const res = await pool.query(
    `UPDATE role_field_permissions
        SET list_permission = 'view_masked'
      WHERE resource = 'leads'
        AND field_name IN ('motherPhone', 'fatherPhone', 'motherEmail', 'fatherEmail')
        AND list_permission = 'none'
      RETURNING role, field_name, list_permission`
  );
  console.log(`Updated ${res.rows.length} role_field_permissions rows.`);
  const byField = {};
  for (const r of res.rows) byField[r.field_name] = (byField[r.field_name] || 0) + 1;
  console.log(byField);

  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

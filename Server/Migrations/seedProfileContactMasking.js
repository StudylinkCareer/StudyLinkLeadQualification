// seedProfileContactMasking.js
// ---------------------------------------------------------------------------
// Restores contact-field masking after the auth-profile cutover. The field-
// level masking rules (role_field_permissions.view_masked) were only ever
// seeded for the 4 legacy roles (Admin/Counselor/Director/Manager); the new
// authorisation PROFILES (Manager, Marketing / Staff, Counsellor / ...) got
// none, so contact data showed in the clear for everyone on a new profile.
//
// This seeds the 22 contact/PII fields as view_masked for every profile EXCEPT
// the Executive tier (CEO, COO), who see contact data unmasked. The assigned
// owner still sees real data — permissionService.applyFieldPermissions un-masks
// view_masked fields for the staff assigned to the lead.
//
// Usage (from Server/):
//   node Migrations/seedProfileContactMasking.js               # DRY RUN (default)
//   node Migrations/seedProfileContactMasking.js --apply       # execute
//   node Migrations/seedProfileContactMasking.js --rollback    # revert this seed
//   add --allow-remote to run against a non-local DB (PROD).
// ---------------------------------------------------------------------------
require('dotenv').config();
const { Pool } = require('pg');

// The 22 contact/PII fields masked by the legacy roles (identical across all 4).
const MASK_FIELDS = [
  'email', 'phone', 'hiddenPhoneCountryCode', 'phoneCountryCode1', 'phoneCountryCode2',
  'contactDetail1', 'contactDetail2', 'contactMedium1', 'contactMedium2', 'facebookProfile',
  'motherEmail', 'motherPhone', 'motherPhoneCountryCode', 'motherContactCC', 'motherContactDetail', 'motherContactMedium',
  'fatherEmail', 'fatherPhone', 'fatherPhoneCountryCode', 'fatherContactCC', 'fatherContactDetail', 'fatherContactMedium',
];
// Executive-tier profiles keep contact data UNMASKED.
const EXEC_PROFILES = ['CEO', 'COO'];
const TAG = 'profile_contact_mask_2026_07_13';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ROLLBACK = args.includes('--rollback');
const ALLOW_REMOTE = args.includes('--allow-remote');

const url = process.env.DATABASE_URL || '';
const host = url.replace(/.*@/, '').split('/')[0];
const isLocal = /localhost|127\.0\.0\.1/.test(host) || /studylink_dev/.test(url);
if (!isLocal && !ALLOW_REMOTE) {
  console.error(`Refusing to run against a non-local DB without --allow-remote. Host: ${host}`);
  process.exit(1);
}
const pool = new Pool({
  connectionString: url,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

(async () => {
  console.log('Target DB host:', host);

  if (ROLLBACK) {
    const r = await pool.query(`DELETE FROM role_field_permissions WHERE updated_by = $1 RETURNING id`, [TAG]);
    console.log(`ROLLBACK: deleted ${r.rowCount} rows seeded by this migration (fields revert to default = unmasked).`);
    await pool.end();
    return;
  }

  // Only profiles that are ACTUALLY broken: they exist in role_permissions but
  // do NOT already mask email. This skips the legacy roles that already mask
  // (so --rollback never strips their existing masking) and the Executives.
  const profiles = (await pool.query(
    `SELECT DISTINCT rp.role
       FROM role_permissions rp
      WHERE NOT EXISTS (
        SELECT 1 FROM role_field_permissions rfp
         WHERE rfp.role = rp.role AND rfp.field_name = 'email' AND rfp.list_permission = 'view_masked')
      ORDER BY rp.role`))
    .rows.map(r => r.role)
    .filter(p => !EXEC_PROFILES.includes(p));

  console.log(`Plan: set list+detail = view_masked on ${MASK_FIELDS.length} contact fields`);
  console.log(`  for ${profiles.length} non-Executive profiles (UNMASKED, excluded: ${EXEC_PROFILES.join(', ')}).`);
  console.log(`  ${profiles.length} × ${MASK_FIELDS.length} = ${profiles.length * MASK_FIELDS.length} rows.`);

  if (!APPLY) {
    console.log('\nDRY RUN — no changes written. Re-run with --apply to execute.');
    console.log('Profiles that will be masked:', JSON.stringify(profiles));
    await pool.end();
    return;
  }

  let n = 0;
  for (const role of profiles) {
    for (const f of MASK_FIELDS) {
      await pool.query(
        `INSERT INTO role_field_permissions (role, resource, field_name, list_permission, detail_permission, updated_at, updated_by)
         VALUES ($1, 'leads', $2, 'view_masked', 'view_masked', now(), $3)
         ON CONFLICT (role, field_name) DO UPDATE
           SET resource = 'leads', list_permission = 'view_masked', detail_permission = 'view_masked',
               updated_at = now(), updated_by = $3`,
        [role, f, TAG]
      );
      n++;
    }
  }
  console.log(`\nAPPLIED: upserted ${n} rows. Restart the backend (or wait 60s for the permission cache) for it to take effect.`);
  await pool.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

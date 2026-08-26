// HOTFIX (2026-08): syncGlobalLeadsDefault.js set list_permission='none' for
// email/phone (among ~37 fields) to hide them from the Leads list COLUMNS,
// per the CEO's request. Side effect not caught before shipping: 'none'
// doesn't just hide the column — permissionService.applyFieldPermissions()
// drops the field from the API response entirely for that context,
// including the '_raw_email'/'_raw_phone' companion values the Leads page's
// search box depends on (Leads.jsx builds its search candidates from
// whatever keys are actually present on each row). Result: searching by
// phone or email returned zero matches for everyone, the same day it shipped.
//
// Fix: revert list_permission for email/phone specifically back to
// 'view_masked' (their pre-existing value — confirmed detail_permission was
// already 'view_masked'/'edit' per role, untouched by the original
// migration; list_permission is the only thing that changed and the only
// thing this reverts). This restores the _raw_* payload so search works
// again. Hiding them as COLUMNS (the actual, correct request) now happens
// as a small explicit frontend-only exclusion in Leads.jsx instead of
// piggybacking on RBAC visibility — decoupling "in the payload for search"
// from "rendered as a column", so this can't recur for these two fields.
//
// Only touches rows this session's own migration set to 'none' on these
// two fields — does not touch the other ~35 fields correctly still hidden.
//
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/fixEmailPhoneSearchRegression.js
//   PROD: node src/migrations/fixEmailPhoneSearchRegression.js --allow-remote
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

  const upd = await pool.query(
    `UPDATE role_field_permissions
        SET list_permission = 'view_masked'
      WHERE resource = 'leads' AND field_name IN ('email', 'phone') AND list_permission = 'none'
    RETURNING role, field_name`
  );
  console.log(`Reverted ${upd.rowCount} rows (list_permission 'none' -> 'view_masked') for email/phone.`);

  const check = await pool.query(
    `SELECT field_name, list_permission, detail_permission FROM role_field_permissions
      WHERE resource='leads' AND field_name IN ('email','phone') ORDER BY field_name LIMIT 6`
  );
  console.log('Sample after:', JSON.stringify(check.rows, null, 2));

  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

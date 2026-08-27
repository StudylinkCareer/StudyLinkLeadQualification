// Grants 'Manager, Marketing' (Ngô Quốc Hoàng's position profile) view access
// to the Sales + Marketing Monthly Report.
//
// Root cause (found 2026-08): staff.staffRole at login uses the specific
// POSITION profile ('Manager, Marketing') instead of the generic 'Manager'
// role whenever that position has ANY seeded role_permissions rows of its
// own (see staffController.js's login, `usePosition = profileExists(position)`).
// 'Manager, Marketing' has 25 rows across other resources but was never
// seeded for resource='reports' — so it silently fell through to 'none'
// (getResourceScope's default) instead of inheriting the generic 'Manager'
// role's reports/view:'all'. Result: the Monthly Report nav item didn't
// render for him, and the API 403'd if hit directly. Không phải chủ ý —
// an oversight from whenever 'Manager, Marketing' was split out as its own
// profile, confirmed by the user to be a real access gap needing a fix.
//
// Idempotent (ON CONFLICT DO NOTHING against the (role,resource,operation)
// uniqueness). Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/grantMarketingManagerReportsView.js
//   PROD: node src/migrations/grantMarketingManagerReportsView.js --allow-remote
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

  const ins = await pool.query(
    `INSERT INTO role_permissions (role, resource, operation, scope)
     VALUES ('Manager, Marketing', 'reports', 'view', 'all')
     ON CONFLICT (role, resource, operation) DO UPDATE SET scope = EXCLUDED.scope
     RETURNING role, resource, operation, scope`
  );
  console.log('Upserted:', JSON.stringify(ins.rows, null, 2));

  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

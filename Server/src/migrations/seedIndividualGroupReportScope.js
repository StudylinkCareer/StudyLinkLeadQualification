// Seeds RBAC scope for the new Individual Report / Company Report (the
// Weekly/Monthly Report merge, planned 2026-08 with Hong Ha). Two new
// operations under the existing 'reports' resource:
//
//   view_individual: 'own' -> can see only their OWN Individual Report.
//                     'all' -> can pick and view ANY staffer's Individual Report.
//   view_group:       'all' -> can see the company-wide Group/Company Report.
//                     no row (-> 'none') -> Group Report hidden entirely.
//
// Deliberately NOT reusing (resource='reports', operation='view') — that key
// is already the binary all/none gate for the OLD, untouched Monthly Report
// and Activity Report, and several roles sit at 'none' there on purpose
// (Counselor, Staff Pre-sales, etc.). Seeding 'own' onto that same key would
// have silently unlocked those old pages for roles meant to stay excluded
// from them. New operation names avoid the collision entirely while keeping
// the same intent: everyone gets at least their own Individual Report;
// Group Report is manager-tier and above only.
//
// Seeded by mirroring each role's CURRENT (leads, view_list) scope, since
// that's the closest existing signal for "is this a manager/lead-tier role":
//   view_list = 'all' or 'team'  -> view_individual='all', view_group='all'
//   view_list = 'own'            -> view_individual='own'  (no view_group row)
//   no view_list row at all      -> skipped (role isn't part of the leads
//                                    pipeline at all, e.g. purely
//                                    marketing/finance-only profiles — can be
//                                    added by hand later if they need report
//                                    access)
//
// Idempotent (ON CONFLICT DO UPDATE). Guard: refuses a non-local DB unless
// --allow-remote.
//   DEV : node src/migrations/seedIndividualGroupReportScope.js
//   PROD: node src/migrations/seedIndividualGroupReportScope.js --allow-remote
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

  const roles = (await pool.query(
    `SELECT role, scope FROM role_permissions WHERE resource='leads' AND operation='view_list'`
  )).rows;

  let individualAll = 0, individualOwn = 0, groupAll = 0;
  for (const { role, scope } of roles) {
    const isManagerTier = scope === 'all' || scope === 'team';
    await pool.query(
      `INSERT INTO role_permissions (role, resource, operation, scope)
       VALUES ($1, 'reports', 'view_individual', $2)
       ON CONFLICT (role, resource, operation) DO UPDATE SET scope = EXCLUDED.scope`,
      [role, isManagerTier ? 'all' : 'own']
    );
    if (isManagerTier) { individualAll++; } else { individualOwn++; }

    if (isManagerTier) {
      await pool.query(
        `INSERT INTO role_permissions (role, resource, operation, scope)
         VALUES ($1, 'reports', 'view_group', 'all')
         ON CONFLICT (role, resource, operation) DO UPDATE SET scope = EXCLUDED.scope`,
        [role]
      );
      groupAll++;
    }
  }
  console.log(`Seeded view_individual: ${individualAll} role(s) at 'all', ${individualOwn} role(s) at 'own'.`);
  console.log(`Seeded view_group: ${groupAll} role(s) at 'all' (everyone else stays 'none' / hidden).`);

  const check = await pool.query(
    `SELECT role, operation, scope FROM role_permissions
      WHERE resource='reports' AND operation IN ('view_individual','view_group') ORDER BY role, operation`
  );
  console.log('Final state:', JSON.stringify(check.rows, null, 2));

  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

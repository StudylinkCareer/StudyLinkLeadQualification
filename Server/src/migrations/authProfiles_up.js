// migrations/authProfiles_up.js
// -----------------------------------------------------------------------------
// Authorisation Profiles — SEED (reversible via authProfiles_down.js).
// Seeds role_permissions keyed by PROFILE (the granular position), from the
// parsed matrix in data/auth_profiles.json. Does NOT touch staff records
// (that's applyStaffProfiles.js) and does NOT delete the legacy roles
// (Admin/Counselor/…) — so rollback is clean.
//
// HARD GUARD: aborts if any profile has zero grants (the lock-out class of bug).
// Dev-guarded: refuses non-localhost/studylink_dev unless --allow-remote.
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const url = process.env.DATABASE_URL || '';
if (!process.argv.includes('--allow-remote') && !(url.includes('localhost') && url.includes('studylink_dev'))) {
  console.error('✗ Refusing: DATABASE_URL is not localhost/studylink_dev. Use --allow-remote for a deliberate run.');
  process.exit(1);
}
const pool = new Pool({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
const profiles = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'auth_profiles.json'), 'utf8'));

async function run() {
  // Guard: no empty profile may be seeded.
  const empty = profiles.filter(p => !p.grants || Object.keys(p.grants).length === 0);
  if (empty.length) { console.error('✗ ABORT — empty profiles would lock users out:', empty.map(p => p.name)); process.exit(1); }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let rows = 0;
    for (const p of profiles) {
      // Clean re-seed for this profile only (idempotent); legacy roles untouched.
      await client.query('DELETE FROM role_permissions WHERE role = $1', [p.name]);
      for (const [key, scope] of Object.entries(p.grants)) {
        const dot = key.indexOf('.');
        const resource = key.slice(0, dot), operation = key.slice(dot + 1);
        await client.query(
          `INSERT INTO role_permissions (role, resource, operation, scope)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (role, resource, operation) DO UPDATE SET scope = EXCLUDED.scope`,
          [p.name, resource, operation, scope]);
        rows++;
      }
    }
    await client.query('COMMIT');
    console.log(`✓ Seeded ${rows} permission rows across ${profiles.length} profiles.`);

    // Verify every profile came back non-empty + has leads.view_list where it has any leads op.
    const check = await client.query(
      `SELECT role, COUNT(*)::int n,
              BOOL_OR(resource='leads' AND operation='view_list') AS has_list,
              BOOL_OR(resource='leads') AS has_leads
         FROM role_permissions WHERE role = ANY($1) GROUP BY role`,
      [profiles.map(p => p.name)]);
    const broken = check.rows.filter(r => r.n === 0 || (r.has_leads && !r.has_list));
    if (broken.length) console.error('⚠ POST-CHECK problems:', broken);
    else console.log('✓ Post-check OK — every profile non-empty; all lead-profiles have view_list.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('✗ Failed, rolled back:', e.message);
    process.exitCode = 1;
  } finally { client.release(); await pool.end(); }
}
run();

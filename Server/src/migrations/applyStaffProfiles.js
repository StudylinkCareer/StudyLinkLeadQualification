// migrations/applyStaffProfiles.js
// Apply the per-staff profile mapping from data/auth_staff_map.json:
//   staff.position <- New Position (the PROFILE)   [drives phase + permissions]
//   staff.role     <- New Role     (the tier)      [display/label]
//
// SAFE BY DEFAULT: dry-run (no writes) unless --apply.
//   --apply     : write, after backing up current position/role to staff_profile_backup
//   --rollback  : restore position/role from staff_profile_backup
// Pre-flight: every target profile MUST already exist in role_permissions with a
// leads.view_list grant (run authProfiles_up.js first) — else it refuses, so nobody
// is switched onto a permission-less profile.
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const url = process.env.DATABASE_URL || '';
const APPLY = process.argv.includes('--apply');
const ROLLBACK = process.argv.includes('--rollback');
if (!process.argv.includes('--allow-remote') && !(url.includes('localhost') && url.includes('studylink_dev'))) {
  console.error('✗ Refusing: not localhost/studylink_dev. Use --allow-remote for a deliberate run.');
  process.exit(1);
}
const pool = new Pool({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
const staffMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'auth_staff_map.json'), 'utf8'));

async function ensureBackup(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS staff_profile_backup (
    email text PRIMARY KEY, old_position text, old_role text, backed_up_at timestamptz DEFAULT NOW())`);
}

async function run() {
  const client = await pool.connect();
  try {
    await ensureBackup(client);

    if (ROLLBACK) {
      const r = await client.query(`UPDATE staff s SET position = b.old_position, role = b.old_role
        FROM staff_profile_backup b WHERE LOWER(s.email) = b.email`);
      console.log(`✓ Rolled back ${r.rowCount} staff to their backed-up position/role.`);
      return;
    }

    // Pre-flight: target profiles must be permissioned.
    const profilesNeeded = [...new Set(staffMap.map(s => s.profile))];
    const ok = new Set((await client.query(
      `SELECT role FROM role_permissions WHERE role = ANY($1) AND resource='leads' AND operation='view_list'`,
      [profilesNeeded])).rows.map(r => r.role));
    const missing = profilesNeeded.filter(p => !ok.has(p));
    if (missing.length) {
      console.error('✗ ABORT — these target profiles have no leads.view_list permission (run authProfiles_up.js first):');
      missing.forEach(m => console.error('   -', m));
      process.exit(1);
    }

    // Match staff by email; report the plan.
    const changes = [];
    for (const s of staffMap) {
      const cur = (await client.query(`SELECT position, role FROM staff WHERE LOWER(email) = $1`, [s.email])).rows[0];
      if (!cur) { console.log(`   (skip — no staff row) ${s.name} <${s.email}>`); continue; }
      if (cur.position === s.profile && cur.role === s.tier) continue;
      changes.push({ email: s.email, name: s.name, from: `${cur.position}/${cur.role}`, to: `${s.profile}/${s.tier}`, profile: s.profile, tier: s.tier });
    }
    console.log(`Plan: ${changes.length} of ${staffMap.length} staff change.\n`);
    changes.forEach(c => console.log(`   ${c.name.padEnd(28)} ${c.from}  →  ${c.profile} / ${c.tier}`));

    if (!APPLY) { console.log('\nDRY-RUN only. Re-run with --apply to write (backs up current values first).'); return; }

    await client.query('BEGIN');
    for (const c of changes) {
      await client.query(`INSERT INTO staff_profile_backup (email, old_position, old_role)
        SELECT LOWER(email), position, role FROM staff WHERE LOWER(email) = $1
        ON CONFLICT (email) DO NOTHING`, [c.email]);
      await client.query(`UPDATE staff SET position = $1, role = $2 WHERE LOWER(email) = $3`,
        [c.profile, c.tier, c.email]);
    }
    await client.query('COMMIT');
    console.log(`\n✓ Applied ${changes.length} staff updates. Backup saved to staff_profile_backup.`);
    console.log('  NEXT: re-sync order_phase (resyncOrderPhases.js) and have affected users re-login.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('✗ Failed, rolled back:', e.message);
    process.exitCode = 1;
  } finally { client.release(); await pool.end(); }
}
run();

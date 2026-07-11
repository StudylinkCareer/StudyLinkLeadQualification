// migrations/authProfiles_down.js
// Rollback of authProfiles_up.js — removes the seeded PROFILE permission rows.
// Legacy roles (Admin/Counselor/Manager/Director/Pre-Sales/Event staff) are left
// untouched, so removing the profiles restores the pre-migration permission state.
// (Staff records are rolled back separately by applyStaffProfiles.js --rollback.)
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const url = process.env.DATABASE_URL || '';
if (!process.argv.includes('--allow-remote') && !(url.includes('localhost') && url.includes('studylink_dev'))) {
  console.error('✗ Refusing: not localhost/studylink_dev. Use --allow-remote for a deliberate run.');
  process.exit(1);
}
const pool = new Pool({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
const profiles = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'auth_profiles.json'), 'utf8'));

(async () => {
  const names = profiles.map(p => p.name);
  const r = await pool.query('DELETE FROM role_permissions WHERE role = ANY($1)', [names]);
  console.log(`✓ Removed ${r.rowCount} profile permission rows for ${names.length} profiles. Legacy roles untouched.`);
  await pool.end();
})().catch(e => { console.error('✗', e.message); process.exit(1); });

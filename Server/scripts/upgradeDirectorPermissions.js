// scripts/upgradeDirectorPermissions.js
// ─────────────────────────────────────────────────────────────────────
// Elevates the Director role to have the broadest scope across all
// resources — matching or exceeding Manager and Admin where appropriate.
//
// Before this migration, Director had very limited access:
//   - staff.view = 'none' (can't see the staff page at all)
//   - staff.set_target = 'none', staff.manage = 'none', staff.edit = 'none'
//   - notes.write_counselor = 'none', notes.write_presales = 'none'
//   - audit.view = 'none'
//   - column_config.manage = 'none'
//
// This script UPSERTs Director to:
//   - leads.* : all  (view_list, view, edit, recalculate, delay_close_date, delete)
//   - staff.* : all  (view, edit, set_target, manage)
//   - notes.* : all  (write_counselor, write_presales, write_management)
//   - audit.view : all
//   - column_config.manage : all
//
// Run after re-deploying the patched Dashboard.jsx.
//
// Usage:
//   node scripts/upgradeDirectorPermissions.js            # dry-run, prints planned diff
//   node scripts/upgradeDirectorPermissions.js --apply    # commits
// ─────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

// Target permissions for Director — "most expansive across the board".
const TARGET = [
  // leads — full read/write
  ['leads', 'view_list',        'all'],
  ['leads', 'view',             'all'],
  ['leads', 'edit',             'all'],
  ['leads', 'delete',           'all'],
  ['leads', 'recalculate',      'all'],
  ['leads', 'delay_close_date', 'all'],

  // staff — view, set targets, manage staff records
  ['staff', 'view',             'all'],
  ['staff', 'edit',             'all'],
  ['staff', 'set_target',       'all'],
  ['staff', 'manage',           'all'],

  // notes — all note types
  ['notes', 'write_counselor',  'all'],
  ['notes', 'write_presales',   'all'],
  ['notes', 'write_management', 'all'],

  // audit log + column config
  ['audit',         'view',   'all'],
  ['column_config', 'manage', 'all'],
];

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Connecting to ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}\n`);

  const client = await pool.connect();
  try {
    // Detect updated_by column once
    const colCheck = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name='role_permissions' AND column_name='updated_by'`
    );
    const hasUpdatedBy = colCheck.rowCount > 0;

    // Show the current vs target diff first
    const current = await client.query(
      `SELECT resource, operation, scope FROM role_permissions
        WHERE role='Director' AND resource IN ('leads','staff','notes','audit','column_config')
        ORDER BY resource, operation`
    );
    const cur = new Map();
    for (const r of current.rows) cur.set(`${r.resource}.${r.operation}`, r.scope);

    console.log('Director permission diff:');
    console.log('─'.repeat(70));
    let changes = 0;
    for (const [resource, operation, newScope] of TARGET) {
      const key = `${resource}.${operation}`;
      const oldScope = cur.get(key);
      if (oldScope === newScope) {
        console.log(`  ${key.padEnd(36)} ${(oldScope||'(absent)').padEnd(8)} (no change)`);
      } else {
        console.log(`  ${key.padEnd(36)} ${(oldScope||'(absent)').padEnd(8)} → ${newScope}`);
        changes++;
      }
    }
    console.log('─'.repeat(70));
    console.log(`${changes} row(s) would change.\n`);

    if (!APPLY) {
      console.log('Dry-run — re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');
    for (const [resource, operation, scope] of TARGET) {
      const sql = hasUpdatedBy
        ? `INSERT INTO role_permissions (role, resource, operation, scope, updated_by)
           VALUES ('Director', $1, $2, $3, 'director_upgrade')
           ON CONFLICT (role, resource, operation)
           DO UPDATE SET scope = EXCLUDED.scope, updated_by = EXCLUDED.updated_by`
        : `INSERT INTO role_permissions (role, resource, operation, scope)
           VALUES ('Director', $1, $2, $3)
           ON CONFLICT (role, resource, operation)
           DO UPDATE SET scope = EXCLUDED.scope`;
      await client.query(sql, [resource, operation, scope]);
    }
    await client.query('COMMIT');
    console.log('✓ Director permissions updated.');
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('Failed, rolled back:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

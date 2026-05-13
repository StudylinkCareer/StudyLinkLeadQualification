// Server/src/services/migrate_extra_role_permissions.js
//
// Adds the resource/operation rows the frontend needs to drive all UI
// affordances from the RBAC tables (no more hardcoded role-name arrays
// in React).
//
// New operations:
//   leads.recalculate          — recalc Risk / OCEAN buttons
//   leads.delay_close_date     — push close date later once status != 'New'
//   notes.write_counselor      — write counselor-tab notes
//   notes.write_presales       — write presales-tab notes
//   notes.write_management     — write management-tab notes
//   staff.manage               — Staff page access + create/edit/deactivate
//   audit.view                 — Audit log access (Admin only)
//   column_config.manage       — Column Settings page (Admin only)
//
// All seeded with updated_by='system_seed' so admin edits via a future
// Phase 5 UI won't be clobbered by re-runs.
//
// Idempotent: ON CONFLICT (role, resource, operation) DO NOTHING.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// [role, resource, operation, scope]
const NEW_PERMISSIONS = [
  // leads.recalculate — anyone who can edit can also recalc
  ['Admin',     'leads', 'recalculate',      'all'],
  ['Manager',   'leads', 'recalculate',      'all'],
  ['Director',  'leads', 'recalculate',      'all'],
  ['Counselor', 'leads', 'recalculate',      'own'],

  // leads.delay_close_date — only Manager/Admin/Director can push dates later
  ['Admin',     'leads', 'delay_close_date', 'all'],
  ['Manager',   'leads', 'delay_close_date', 'all'],
  ['Director',  'leads', 'delay_close_date', 'all'],
  ['Counselor', 'leads', 'delay_close_date', 'none'],

  // notes.write_counselor — counselors + manager/admin
  ['Admin',     'notes', 'write_counselor',  'all'],
  ['Manager',   'notes', 'write_counselor',  'all'],
  ['Counselor', 'notes', 'write_counselor',  'own'],
  ['Director',  'notes', 'write_counselor',  'none'],

  // notes.write_presales — same as counselor tab
  ['Admin',     'notes', 'write_presales',   'all'],
  ['Manager',   'notes', 'write_presales',   'all'],
  ['Counselor', 'notes', 'write_presales',   'own'],
  ['Director',  'notes', 'write_presales',   'none'],

  // notes.write_management — Director + manager/admin (not counselors)
  ['Admin',     'notes', 'write_management', 'all'],
  ['Manager',   'notes', 'write_management', 'all'],
  ['Director',  'notes', 'write_management', 'all'],
  ['Counselor', 'notes', 'write_management', 'none'],

  // staff.manage — Add/edit/deactivate/reset password (full management)
  ['Admin',     'staff', 'manage', 'all'],
  ['Manager',   'staff', 'manage', 'none'],
  ['Director',  'staff', 'manage', 'none'],
  ['Counselor', 'staff', 'manage', 'none'],

  // staff.set_target — set staff sales target (Admin and Manager only)
  ['Admin',     'staff', 'set_target', 'all'],
  ['Manager',   'staff', 'set_target', 'all'],
  ['Director',  'staff', 'set_target', 'none'],
  ['Counselor', 'staff', 'set_target', 'none'],

  // audit.view — audit log access
  ['Admin',     'audit', 'view',   'all'],
  ['Manager',   'audit', 'view',   'none'],
  ['Director',  'audit', 'view',   'none'],
  ['Counselor', 'audit', 'view',   'none'],

  // column_config.manage — Column Settings page
  ['Admin',     'column_config', 'manage', 'all'],
  ['Manager',   'column_config', 'manage', 'none'],
  ['Director',  'column_config', 'manage', 'none'],
  ['Counselor', 'column_config', 'manage', 'none'],
];

async function run() {
  const client = await pool.connect();
  try {
    console.log('═'.repeat(60));
    console.log('Seeding extra role_permissions for frontend RBAC');
    console.log('═'.repeat(60));

    await client.query('BEGIN');

    // Detect whether role_permissions has an updated_by column so we don't
    // crash on schemas where it's absent (permission_fields has none either).
    const colCheck = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'role_permissions' AND column_name = 'updated_by'
    `);
    const hasUpdatedBy = colCheck.rowCount > 0;
    console.log(`\nrole_permissions.updated_by column ${hasUpdatedBy ? 'EXISTS' : 'NOT PRESENT'} — adjusting INSERT accordingly`);

    let inserted = 0;
    for (const [role, resource, operation, scope] of NEW_PERMISSIONS) {
      const sql = hasUpdatedBy
        ? `INSERT INTO role_permissions (role, resource, operation, scope, updated_by)
           VALUES ($1, $2, $3, $4, 'system_seed')
           ON CONFLICT (role, resource, operation) DO NOTHING`
        : `INSERT INTO role_permissions (role, resource, operation, scope)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (role, resource, operation) DO NOTHING`;
      const result = await client.query(sql, [role, resource, operation, scope]);
      inserted += result.rowCount;
    }
    console.log(`Inserted ${inserted} new row(s) (${NEW_PERMISSIONS.length - inserted} already existed)`);
    await client.query('COMMIT');

    // Verification: show the full new resource list per role
    const verify = await client.query(`
      SELECT role, resource, operation, scope
      FROM role_permissions
      WHERE resource IN ('leads', 'notes', 'staff', 'audit', 'column_config')
      ORDER BY role, resource, operation
    `);
    console.log('\nFinal role_permissions:');
    let currentRole = null;
    verify.rows.forEach(r => {
      if (r.role !== currentRole) {
        currentRole = r.role;
        console.log(`\n  ${r.role}:`);
      }
      console.log(`    ${r.resource}.${r.operation.padEnd(20)} ${r.scope}`);
    });

    console.log('\n✓ Migration complete\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n✗ Migration failed, rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

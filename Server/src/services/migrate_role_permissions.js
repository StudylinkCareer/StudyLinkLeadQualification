// migrate_role_permissions.js
// ---------------------------------------------------------------------------
// PHASE 1 of role-based access control work (Item 2).
//
// One-time migration: creates the role_permissions table and seeds it with
// the default rules agreed on:
//
//   - Admin     : full access (view list, view detail, edit, delete)
//   - Manager   : full access except delete
//   - Director  : full access except delete
//   - Counselor : sees ALL leads in the list, but can only access/edit
//                 leads where their name appears in counselor,
//                 seniorCounselor, presales, or marketingStaff
//
// SAFETY:
//   - Does NOT drop or alter any existing tables.
//   - CREATE TABLE IF NOT EXISTS — won't error if table already exists.
//   - INSERT ... ON CONFLICT DO NOTHING — won't duplicate seed rows or
//     overwrite later edits made by Admin via the settings page.
//   - Safe to re-run any time.
//
// HOW TO RUN:
//   Place this file in Server/src/services/ (alongside db.js).
//   Then from any directory, in PowerShell:
//       node C:\Users\rhod_\Documents\StudyLinkLeadQualification\Server\src\services\migrate_role_permissions.js
//   Or just cd into Server/src/services/ first and run:
//       node migrate_role_permissions.js
// ---------------------------------------------------------------------------

// ─── Load .env regardless of where the script is run from ────────────────
// __dirname is the folder this .js file lives in (Server/src/services/).
// We go up two levels to Server/, where .env lives. This makes the script
// CWD-agnostic — you can run it from anywhere.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Fail loud and early if DATABASE_URL still isn't set — clearer than the
// SASL error pg throws when it gets undefined credentials.
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set.');
  console.error('   Check that Server/.env exists and contains DATABASE_URL=...');
  process.exit(1);
}

const pool = require('./db');

async function migrate() {
  try {
    // ─── Create the role_permissions table ─────────────────────────────
    // Columns:
    //   role       — 'Admin' | 'Manager' | 'Director' | 'Counselor'
    //   resource   — what the rule applies to (currently only 'leads',
    //                room to add 'staff','documents',etc. later)
    //   operation  — 'view_list' | 'view_detail' | 'edit' | 'delete'
    //   scope      — 'all'  : any record
    //                'own'  : only records assigned to this staff member
    //                'none' : forbidden
    //   updated_by — staff name who last edited this row (for audit /
    //                showing "last changed by X on Y" in the admin UI)
    //
    // The UNIQUE constraint on (role, resource, operation) means there's
    // exactly one rule per combination.
    // ───────────────────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id          SERIAL       PRIMARY KEY,
        role        VARCHAR(50)  NOT NULL,
        resource    VARCHAR(50)  NOT NULL,
        operation   VARCHAR(50)  NOT NULL,
        scope       VARCHAR(20)  NOT NULL DEFAULT 'none',
        updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_by  VARCHAR(255),
        UNIQUE (role, resource, operation)
      );
    `);

    // ─── Seed the default rules ───────────────────────────────────────
    // 4 roles × 4 operations on the 'leads' resource = 16 rows.
    // ──────────────────────────────────────────────────────────────────
    const seedRows = [
      // role         resource  operation       scope
      ['Admin',     'leads', 'view_list',   'all'],
      ['Admin',     'leads', 'view_detail', 'all'],
      ['Admin',     'leads', 'edit',        'all'],
      ['Admin',     'leads', 'delete',      'all'],

      ['Manager',   'leads', 'view_list',   'all'],
      ['Manager',   'leads', 'view_detail', 'all'],
      ['Manager',   'leads', 'edit',        'all'],
      ['Manager',   'leads', 'delete',      'none'],

      ['Director',  'leads', 'view_list',   'all'],
      ['Director',  'leads', 'view_detail', 'all'],
      ['Director',  'leads', 'edit',        'all'],
      ['Director',  'leads', 'delete',      'none'],

      ['Counselor', 'leads', 'view_list',   'all'],
      ['Counselor', 'leads', 'view_detail', 'own'],
      ['Counselor', 'leads', 'edit',        'own'],
      ['Counselor', 'leads', 'delete',      'none'],
    ];

    for (const [role, resource, operation, scope] of seedRows) {
      await pool.query(
        `INSERT INTO role_permissions (role, resource, operation, scope, updated_by)
         VALUES ($1, $2, $3, $4, 'system_seed')
         ON CONFLICT (role, resource, operation) DO NOTHING`,
        [role, resource, operation, scope]
      );
    }

    // ─── Report what's in the table now ───────────────────────────────
    const { rows } = await pool.query(`
      SELECT role, operation, scope
      FROM role_permissions
      WHERE resource = 'leads'
      ORDER BY
        CASE role
          WHEN 'Admin'     THEN 1
          WHEN 'Manager'   THEN 2
          WHEN 'Director'  THEN 3
          WHEN 'Counselor' THEN 4
        END,
        CASE operation
          WHEN 'view_list'   THEN 1
          WHEN 'view_detail' THEN 2
          WHEN 'edit'        THEN 3
          WHEN 'delete'      THEN 4
        END
    `);

    console.log('✅ role_permissions table is ready.');
    console.log(`✅ ${rows.length} rows present for resource = "leads":`);
    console.table(rows);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

// install_field_autoseed_trigger.js
// -----------------------------------------------------------------------------
// Installs a PostgreSQL trigger so that when a new row is inserted into
// permission_fields, role_field_permissions is automatically populated with
// one row per known role (DISTINCT role FROM role_permissions), using
// defaults you can edit below.
//
// After running this once, adding a new column to your system becomes a
// SINGLE INSERT:
//
//   INSERT INTO permission_fields (field_name, category, label, column_width,
//                                  column_order)
//   VALUES ('newField', 'other', 'New Field', 120, 99);
//
// …and ALL roles immediately get the default ACL rows. No code change.
//
// To override the defaults for a specific role afterwards, just UPDATE
// role_field_permissions for that (role, field_name) pair as normal.
//
// USAGE:
//   node install_field_autoseed_trigger.js
// -----------------------------------------------------------------------------

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

// ── EDIT THESE DEFAULTS IF YOU WANT DIFFERENT PER-CATEGORY BEHAVIOR ─────────
// The trigger checks the new field's category and picks a default. Tune to
// match your "all roles can see everything except contact" rule.
const DEFAULTS_SQL = `
  -- Default list_permission and detail_permission per category.
  -- personal_contact:  list=view_masked, detail=view_masked (Counselor/Director get edit on detail)
  -- everything else:   list=view,        detail=edit
`;
// ────────────────────────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Ensuring unique constraint on role_field_permissions (role, field_name)…');
    // Required for the ON CONFLICT clause inside the trigger. Idempotent.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'role_field_permissions_role_field_name_key'
        ) THEN
          ALTER TABLE role_field_permissions
            ADD CONSTRAINT role_field_permissions_role_field_name_key
            UNIQUE (role, field_name);
        END IF;
      END
      $$;
    `);

    console.log('Installing autoseed trigger function…');
    await client.query(`
      CREATE OR REPLACE FUNCTION autoseed_role_field_permissions()
      RETURNS TRIGGER AS $$
      DECLARE
        r RECORD;
        v_list TEXT;
        v_detail TEXT;
      BEGIN
        -- For each role currently configured in role_permissions, insert a
        -- (role, field_name) ACL row with category-aware defaults.
        FOR r IN SELECT DISTINCT role FROM role_permissions ORDER BY role LOOP

          -- Default rule set:
          --   personal_contact -> masked everywhere, except Counselor & Director
          --     can edit on detail.
          --   anything else    -> view in list, edit in detail.
          IF NEW.category = 'personal_contact' THEN
            v_list := 'view_masked';
            IF r.role IN ('Counselor', 'Director') THEN
              v_detail := 'edit';
            ELSE
              v_detail := 'view_masked';
            END IF;
          ELSE
            v_list   := 'view';
            v_detail := 'edit';
          END IF;

          -- Skip if a row already exists (idempotent).
          INSERT INTO role_field_permissions
            (role, field_name, resource, list_permission, detail_permission)
          VALUES
            (r.role, NEW.field_name, NEW.resource, v_list, v_detail)
          ON CONFLICT (role, field_name) DO NOTHING;

        END LOOP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    console.log('Attaching trigger to permission_fields…');
    await client.query(`
      DROP TRIGGER IF EXISTS trg_autoseed_role_field_permissions
        ON permission_fields;
      CREATE TRIGGER trg_autoseed_role_field_permissions
        AFTER INSERT ON permission_fields
        FOR EACH ROW
        EXECUTE FUNCTION autoseed_role_field_permissions();
    `);

    // Verification: insert a temp row, check it seeded, then roll back.
    console.log('Verifying trigger fires correctly…');
    await client.query(`
      INSERT INTO permission_fields (field_name, category, resource)
      VALUES ('__autoseed_test__', 'other', 'leads');
    `);
    const check = await client.query(
      `SELECT role, list_permission, detail_permission
       FROM role_field_permissions
       WHERE field_name = '__autoseed_test__'
       ORDER BY role`
    );
    console.log('Seeded rows for test field:');
    check.rows.forEach(row => {
      console.log(`  ${row.role.padEnd(10)} list=${row.list_permission.padEnd(12)} detail=${row.detail_permission}`);
    });

    // Clean up the test row (CASCADE handles the ACL rows if you have FKs;
    // if not, delete them explicitly).
    await client.query(`DELETE FROM role_field_permissions WHERE field_name = '__autoseed_test__'`);
    await client.query(`DELETE FROM permission_fields      WHERE field_name = '__autoseed_test__'`);

    await client.query('COMMIT');
    console.log('\n✓ Trigger installed successfully.');
    console.log('\nFrom now on:');
    console.log('  INSERT INTO permission_fields (field_name, category, resource, label, column_width, column_order)');
    console.log("  VALUES ('myNewField', 'other', 'leads', 'My New Field', 130, 99);");
    console.log('\n…will automatically create role_field_permissions rows for every role.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();

// server/src/migrations/registerLeadColumns.js
// Run from Server\ :  node src/migrations/registerLeadColumns.js
//
// R3 Phase 1 — register the new Source-of-Lead fields as Leads columns so they
// appear in the list, the Column Settings page, and become sortable / filterable
// / hideable / resequenceable. The whole Leads UI is catalog-driven from
// permission_fields, so registering here is all the frontend needs.
//
// Additive + idempotent:
//   • students        : ensure source, source_detail, source_unverified, major,
//                       school_attended, ward columns exist
//   • permission_fields: add catalog rows (resource='leads') for the 5 visible
//                       fields, append column_order after the current max,
//                       and relabel leadSource → "Source of Lead"
//   • role_field_permissions: list=view / detail=edit for the 4 matrix roles
//                       (other roles fall back to view/edit by default)

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const RESOURCE = 'leads';
// [ field_name (camelCase), category, label, column_width ]
// category 'campaign'/'other' = open (view/edit); NOT 'personal_contact' so
// these are never masked.
const NEW_FIELDS = [
  ['source',         'campaign', 'Source',          160],
  ['sourceDetail',   'campaign', 'Source detail',   180],
  ['major',          'other',    'Major',           150],
  ['schoolAttended', 'other',    'School attended', 200],
  ['ward',           'other',    'Ward',            140],
];
const ROLES = ['Admin', 'Manager', 'Director', 'Counselor'];

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. students columns
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS source            VARCHAR(200)`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS source_detail     VARCHAR(200)`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS source_unverified BOOLEAN NOT NULL DEFAULT false`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS major             VARCHAR(200)`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS school_attended   VARCHAR(200)`);
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS ward              VARCHAR(200)`);
    console.log('✓ students columns ensured');

    // 2. catalog ordering columns (defensive — added by earlier metadata migration)
    await client.query(`ALTER TABLE permission_fields ADD COLUMN IF NOT EXISTS column_order INTEGER`);
    await client.query(`ALTER TABLE permission_fields ADD COLUMN IF NOT EXISTS column_width INTEGER`);

    const max = await client.query(
      `SELECT COALESCE(MAX(column_order), 0) AS m FROM permission_fields WHERE resource = $1`, [RESOURCE]);
    let order = max.rows[0].m;

    for (const [field, category, label, width] of NEW_FIELDS) {
      order += 1;
      await client.query(
        `INSERT INTO permission_fields (resource, field_name, category, label, column_order, column_width)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (resource, field_name)
         DO UPDATE SET label = EXCLUDED.label, category = EXCLUDED.category`,
        [RESOURCE, field, category, label, order, width]);
      for (const role of ROLES) {
        await client.query(
          `INSERT INTO role_field_permissions (role, resource, field_name, list_permission, detail_permission, updated_by)
           VALUES ($1, $2, $3, 'view', 'edit', 'system_seed')
           ON CONFLICT (role, resource, field_name) DO NOTHING`,
          [role, RESOURCE, field]);
      }
    }
    console.log(`✓ registered ${NEW_FIELDS.length} fields in permission_fields (+ role permissions)`);

    // 3. rename the existing Lead source column to "Source of Lead"
    const lbl = await client.query(
      `UPDATE permission_fields SET label = 'Source of Lead' WHERE resource = $1 AND field_name = 'leadSource'`, [RESOURCE]);
    console.log(`✓ relabelled leadSource → "Source of Lead" (${lbl.rowCount} row)`);

    await client.query('COMMIT');
    console.log('\n✓ R3 Phase 1 registration complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed (rolled back):', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();

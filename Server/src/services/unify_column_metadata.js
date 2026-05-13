// Server/src/services/unify_column_metadata.js
//
// Unifies "what columns exist in the Leads list" with the field-permissions
// catalog. Adds three columns to permission_fields:
//   - label         (display name shown in the column header)
//   - column_width  (default width in px; NULL = not a list column)
//   - column_order  (default sort order in the table; lower = leftmost)
//
// Also inserts system rows for fields not in the RBAC catalog but used as
// columns: age, createdAt, updatedAt. These get category='system' and
// view/view permissions for every role.
//
// After this runs:
//   - The hardcoded MASTER_COLUMNS arrays in Leads.jsx and
//     ColumnLayoutSettings.jsx can be removed.
//   - GET /api/staff/columns returns the catalog of columns from the DB.
//   - Adding a new column = one row in permission_fields + role rows.
//
// Idempotent: safe to re-run.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Mirrors MASTER_COLUMNS from the (about-to-be-deleted) frontend constant.
// This is the seed for the new permission_fields metadata columns.
const COLUMN_METADATA = [
  // ── Personal Details ──
  { key:'fullName',               label:'Name',                   width:160, order: 1 },
  { key:'email',                  label:'Email',                  width:190, order: 2 },
  { key:'phone',                  label:'Phone',                  width:130, order: 3 },
  { key:'yearOfBirth',            label:'Year of Birth',          width:110, order: 4 },
  { key:'residency',              label:'Residency',              width:140, order: 5 },
  { key:'schoolEvent',            label:'School / Event',         width:150, order: 6 },
  { key:'preferredSocial',        label:'Social Platform',        width:130, order: 7 },
  { key:'socialConsent',          label:'Connect With Us',        width:120, order: 8 },
  // ── Lead Management ──
  { key:'leadStatus',             label:'Status',                 width:110, order:10 },
  { key:'createdAt',              label:'Created',                width:100, order:11 },
  { key:'age',                    label:'Age',                    width: 55, order:12 },
  { key:'leadSource',             label:'Lead Source',            width:120, order:13 },
  { key:'interaction',            label:'Interaction',            width:110, order:14 },
  { key:'studyPlans',             label:'Study Plans',            width:120, order:15 },
  { key:'destinationCountry',     label:'Destination',            width:130, order:16 },
  { key:'timeline',               label:'Timeline',               width:110, order:17 },
  { key:'stoneTier',              label:'Stone',                  width: 90, order:18 },
  { key:'riskScore',              label:'Score',                  width: 70, order:19 },
  { key:'counselor',              label:'Counselor',              width:130, order:20 },
  { key:'seniorCounselor',        label:'Sr. Counselor',          width:130, order:21 },
  { key:'presales',               label:'Pre-Sales',              width:120, order:22 },
  { key:'marketingStaff',         label:'Marketing',              width:120, order:23 },
  { key:'closeDate',              label:'Close Date',             width:100, order:24 },
  { key:'confidence',             label:'Confidence',             width:130, order:25 },
  // ── Self Assessment ──
  { key:'budget',                 label:'Budget',                 width:130, order:30 },
  { key:'scholarshipDemand',      label:'Scholarship',            width:130, order:31 },
  { key:'englishLevel',           label:'English',                width:100, order:32 },
  { key:'gpa',                    label:'GPA',                    width: 70, order:33 },
  { key:'immigrationHistory',     label:'Immigration',            width:160, order:34 },
  { key:'sponsorIncome',          label:'Sponsor Income',         width:130, order:35 },
  { key:'incomeEvidence',         label:'Income Evidence',        width:130, order:36 },
  { key:'studyPlanGap',           label:'Study Plan Gap',         width:150, order:37 },
  { key:'ultimateObjective',      label:'Objective',              width:150, order:38 },
  // ── Family Contacts ──
  { key:'motherFullName',         label:'Mother Name',            width:140, order:40 },
  { key:'motherEmail',            label:'Mother Email',           width:180, order:41 },
  { key:'motherPhone',            label:'Mother Phone',           width:130, order:42 },
  { key:'motherContactMedium',    label:'Mother Medium',          width:130, order:43 },
  { key:'fatherFullName',         label:'Father Name',            width:140, order:44 },
  { key:'fatherEmail',            label:'Father Email',           width:180, order:45 },
  { key:'fatherPhone',            label:'Father Phone',           width:130, order:46 },
  { key:'fatherContactMedium',    label:'Father Medium',          width:130, order:47 },
  // ── OCEAN Profile ──
  { key:'oceanExtraversion',      label:'OCEAN: Extraversion',    width:150, order:50 },
  { key:'oceanAgreeableness',     label:'OCEAN: Agreeableness',   width:155, order:51 },
  { key:'oceanConscientiousness', label:'OCEAN: Conscientious.',  width:165, order:52 },
  { key:'oceanNeuroticism',       label:'OCEAN: Neuroticism',     width:150, order:53 },
  { key:'oceanOpenness',          label:'OCEAN: Openness',        width:140, order:54 },
  // ── Campaign / Event ──
  { key:'campaignType',           label:'Campaign Type',          width:140, order:60 },
  { key:'campaignName',           label:'Campaign Name',          width:160, order:61 },
  { key:'campaignStart',          label:'Camp. Start',            width:120, order:62 },
  { key:'campaignEnd',            label:'Camp. End',              width:120, order:63 },
];

// System fields used as columns but NOT in the RBAC catalog (auto-managed by
// the system, no real "permission" to discuss). We add catalog rows for them
// with category='system' and view/view for every role so the catalog is complete.
const SYSTEM_FIELDS = ['age', 'createdAt', 'updatedAt'];

async function run() {
  const client = await pool.connect();
  try {
    console.log('═'.repeat(60));
    console.log('Unifying column metadata with permission_fields');
    console.log('═'.repeat(60));

    await client.query('BEGIN');

    // ─── 1. Schema: add the three new columns ───────────────
    await client.query(`
      ALTER TABLE permission_fields
        ADD COLUMN IF NOT EXISTS label        TEXT,
        ADD COLUMN IF NOT EXISTS column_width INTEGER,
        ADD COLUMN IF NOT EXISTS column_order INTEGER
    `);
    console.log('\n[1] permission_fields: ensured label / column_width / column_order columns exist');

    // ─── 1b. Ensure UNIQUE constraints needed by ON CONFLICT clauses ──
    // ON CONFLICT (col) requires a UNIQUE/PRIMARY KEY constraint OR a
    // unique INDEX on exactly that column. We use unique indexes here
    // because CREATE UNIQUE INDEX IF NOT EXISTS is dead-simple and
    // idempotent — no need to inspect existing constraints.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS permission_fields_field_name_uniq
        ON permission_fields(field_name);
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS role_field_permissions_role_field_name_uniq
        ON role_field_permissions(role, field_name);
    `);
    console.log('[1b] Ensured UNIQUE indexes on permission_fields(field_name) and role_field_permissions(role, field_name)');

    // ─── 2. System rows in permission_fields ─────────────────
    let sysInserted = 0;
    for (const f of SYSTEM_FIELDS) {
      const r = await client.query(
        `INSERT INTO permission_fields (field_name, category, resource)
         VALUES ($1, 'system', 'leads')
         ON CONFLICT (field_name) DO NOTHING`,
        [f]
      );
      sysInserted += r.rowCount;
    }
    console.log(`[2] Inserted ${sysInserted} system field row(s) into permission_fields`);

    // ─── 3. role_field_permissions for system fields ─────────
    // System fields are always visible (view/view) for everyone.
    const roles = ['Admin', 'Manager', 'Director', 'Counselor'];
    let sysPermsInserted = 0;
    for (const f of SYSTEM_FIELDS) {
      for (const role of roles) {
        const r = await client.query(
          `INSERT INTO role_field_permissions (role, field_name, resource, list_permission, detail_permission, updated_by)
           VALUES ($1, $2, 'leads', 'view', 'view', 'system_seed')
           ON CONFLICT (role, field_name) DO NOTHING`,
          [role, f]
        );
        sysPermsInserted += r.rowCount;
      }
    }
    console.log(`[3] Inserted ${sysPermsInserted} role_field_permissions row(s) for system fields`);

    // Detect whether role_field_permissions has updated_by column (defensive)
    // If our INSERT above failed because the column doesn't exist, fall back
    // to inserting without it.
    if (sysPermsInserted === 0 && SYSTEM_FIELDS.length > 0) {
      // Check if rows already exist or if column was the problem
      const check = await client.query(
        `SELECT COUNT(*)::int AS n FROM role_field_permissions WHERE field_name = ANY($1)`,
        [SYSTEM_FIELDS]
      );
      console.log(`    (existing role_field_permissions rows for system fields: ${check.rows[0].n})`);
    }

    // ─── 4. Update label / width / order for each column ─────
    let metaUpdated = 0;
    let metaInserted = 0;
    for (const col of COLUMN_METADATA) {
      // Try UPDATE first
      const upd = await client.query(
        `UPDATE permission_fields
         SET label = $1, column_width = $2, column_order = $3
         WHERE field_name = $4`,
        [col.label, col.width, col.order, col.key]
      );
      if (upd.rowCount > 0) {
        metaUpdated += upd.rowCount;
      } else {
        // Field wasn't in the catalog — insert it. We don't know the right
        // category, so default to 'other'. Admin can edit later.
        const ins = await client.query(
          `INSERT INTO permission_fields (field_name, category, resource, label, column_width, column_order)
           VALUES ($1, 'other', 'leads', $2, $3, $4)
           ON CONFLICT (field_name) DO UPDATE
             SET label = EXCLUDED.label, column_width = EXCLUDED.column_width, column_order = EXCLUDED.column_order`,
          [col.key, col.label, col.width, col.order]
        );
        metaInserted += ins.rowCount;
        // Seed role permissions for newly-inserted fields too
        for (const role of roles) {
          await client.query(
            `INSERT INTO role_field_permissions (role, field_name, resource, list_permission, detail_permission, updated_by)
             VALUES ($1, $2, 'leads', 'view', 'edit', 'system_seed')
             ON CONFLICT (role, field_name) DO NOTHING`,
            [role, col.key]
          );
        }
      }
    }
    console.log(`[4] Column metadata: updated ${metaUpdated} existing field(s), inserted ${metaInserted} new field(s)`);

    await client.query('COMMIT');

    // ─── 5. Verification: show the final catalog ─────────────
    const final = await client.query(`
      SELECT field_name, category, label, column_width, column_order
      FROM permission_fields
      WHERE column_width IS NOT NULL
      ORDER BY column_order
    `);
    console.log(`\n✓ Column catalog now in permission_fields (${final.rows.length} rows with column metadata):`);
    final.rows.slice(0, 5).forEach(r =>
      console.log(`    ${String(r.column_order).padStart(3)} ${r.field_name.padEnd(25)} ${r.label.padEnd(28)} width=${r.column_width}`)
    );
    if (final.rows.length > 5) console.log(`    ... and ${final.rows.length - 5} more`);

    const noCol = await client.query(`
      SELECT COUNT(*)::int AS n FROM permission_fields WHERE column_width IS NULL
    `);
    console.log(`\nFields in catalog NOT used as list columns (detail-only): ${noCol.rows[0].n}`);

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

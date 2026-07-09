// Server/src/migrations/addLeadSalesDateColumns.js
// ---------------------------------------------------------------------------
// Leads-list column catalog for the lead-vs-sales date split:
//   - Relabels the existing lead-level date columns "Lead ⋯" (they now resolve
//     to the LEAD's own values, since leads has its own created/updated/assigned
//     columns and l.* wins in searchLeads).
//   - Adds four person-level ("Sales ⋯") date columns, fed by aliased columns
//     in searchLeads (person_created_at / person_updated_at / person_assigned_in
//     / person_assigned_out).
//
// Idempotent: UPDATE ... / INSERT ... ON CONFLICT. Safe to re-run / cutover.
// ---------------------------------------------------------------------------

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const url = process.env.DATABASE_URL || '';
const allowRemote = process.argv.includes('--allow-remote');
if (!allowRemote && !(url.includes('localhost') && url.includes('studylink_dev'))) {
  console.error('✗ Refusing to run: DATABASE_URL is not localhost/studylink_dev. Use --allow-remote for a deliberate PROD run.');
  process.exit(1);
}

// Relabel existing lead-level columns (+ give updatedAt an order/width so it shows).
const RELABEL = [
  { key: 'createdAt',   label: 'Lead Created',      order: 11, width: 110 },
  { key: 'updatedAt',   label: 'Lead Updated',      order: 12, width: 110 },
  { key: 'assignedIn',  label: 'Lead Assigned In',  order: 26, width: 120 },
  { key: 'assignedOut', label: 'Lead Assigned Out', order: 27, width: 120 },
];

// New person-level ("Sales ⋯") columns.
const PERSON_COLS = [
  { key: 'personCreatedAt',   label: 'Sales Created',      order: 30, width: 110 },
  { key: 'personUpdatedAt',   label: 'Sales Updated',      order: 31, width: 110 },
  { key: 'personAssignedIn',  label: 'Sales Assigned In',  order: 32, width: 120 },
  { key: 'personAssignedOut', label: 'Sales Assigned Out', order: 33, width: 120 },
];

const ROLES = ['Admin', 'Manager', 'Director', 'Counselor'];

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const c of RELABEL) {
      await client.query(
        `UPDATE permission_fields
            SET label = $2, column_order = $3, column_width = $4
          WHERE field_name = $1 AND resource = 'leads'`,
        [c.key, c.label, c.order, c.width]
      );
    }
    console.log('[1] lead-level date columns relabelled "Lead ⋯"');

    for (const c of PERSON_COLS) {
      await client.query(
        `INSERT INTO permission_fields (field_name, category, resource, label, column_width, column_order)
         VALUES ($1, 'other', 'leads', $2, $3, $4)
         ON CONFLICT (field_name) DO UPDATE
           SET label = EXCLUDED.label, column_width = EXCLUDED.column_width, column_order = EXCLUDED.column_order`,
        [c.key, c.label, c.width, c.order]
      );
      for (const role of ROLES) {
        await client.query(
          `INSERT INTO role_field_permissions (role, field_name, resource, list_permission, detail_permission, updated_by)
           VALUES ($1, $2, 'leads', 'view', 'view', 'lead_sales_dates_seed')
           ON CONFLICT (role, field_name) DO NOTHING`,
          [role, c.key]
        );
      }
    }
    console.log('[2] person-level "Sales ⋯" date columns seeded + role permissions');

    await client.query('COMMIT');
    console.log('\n✓ addLeadSalesDateColumns complete\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n✗ Failed, rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });

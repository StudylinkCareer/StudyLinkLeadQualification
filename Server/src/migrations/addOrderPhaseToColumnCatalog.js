// server/src/migrations/addOrderPhaseToColumnCatalog.js
//
// Surfaces the Sales Order's phase/department on the Leads list by registering
// `orderPhase` in the Leads-list column catalog (permission_fields), so it
// becomes selectable in Column Settings, renderable as a grid column, and
// filterable via the list's faceted value-dropdown (Pool / Counselling /
// Presales / Marketing / …).
//
// The catalog = rows in permission_fields where column_width IS NOT NULL
// (staffController.listColumns). `order_phase` is a neutral, non-PII field on
// `students` (surfaced per lead via searchLeads' SELECT s.*), so the default
// field-permission { list:'view', detail:'edit' } applies and no
// role_field_permissions rows are needed — every role sees it unmasked.
//
// SAFETY: localhost-guarded, transaction-wrapped, idempotent, reversible
// (--reset removes the catalog entry again; it does NOT touch students.order_phase).
//
// USAGE (from Server/, DATABASE_URL -> studylink_dev):
//   node src/migrations/addOrderPhaseToColumnCatalog.js          # add to catalog
//   node src/migrations/addOrderPhaseToColumnCatalog.js --reset  # remove again
//   (append --allow-remote at the PROD cutover)

require('dotenv').config();
const { Pool } = require('pg');

const ARGS         = process.argv.slice(2);
const RESET        = ARGS.includes('--reset');
const ALLOW_REMOTE = ARGS.includes('--allow-remote');

const ENTRY = { field: 'orderPhase', label: 'Order Phase', category: 'other', width: 130 };

function hostOf(url) {
  const m = /@([^:@/]+)(?::\d+)?\//.exec(url || '');
  return m ? m[1] : '(unparseable)';
}

async function main() {
  const url  = process.env.DATABASE_URL || '';
  const host = hostOf(url);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);

  console.log(`Target DB host: ${host}`);
  console.log(`Direction: ${RESET ? 'REMOVE catalog entry (--reset)' : 'ADD catalog entry'}`);
  if (!isLocal && !ALLOW_REMOTE) {
    console.error(`\nABORT: refuses to run against non-local host "${host}". Point DATABASE_URL at studylink_dev.`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!(await client.query(`SELECT to_regclass('public.permission_fields') AS t`)).rows[0].t) {
      throw new Error('Table "permission_fields" does not exist.');
    }

    if (RESET) {
      const res = await client.query(
        `DELETE FROM permission_fields WHERE resource = 'leads' AND field_name = $1`, [ENTRY.field]);
      console.log(`removed ${res.rowCount} catalog row(s)`);
    } else {
      // Append after the current max column_order so it lands at the end of the grid
      // (the user can drag-reorder + Save default afterwards).
      const maxOrder = Number((await client.query(
        `SELECT COALESCE(MAX(column_order), 0) AS m FROM permission_fields`)).rows[0].m);
      const ord = maxOrder + 1;
      const existing = await client.query(
        `SELECT id FROM permission_fields WHERE resource = 'leads' AND field_name = $1 LIMIT 1`, [ENTRY.field]);
      if (existing.rowCount) {
        await client.query(
          `UPDATE permission_fields SET label = $1, category = $2, column_width = $3, column_order = $4 WHERE id = $5`,
          [ENTRY.label, ENTRY.category, ENTRY.width, ord, existing.rows[0].id]);
        console.log(`updated catalog: ${ENTRY.field} -> "${ENTRY.label}" (width ${ENTRY.width}, order ${ord})`);
      } else {
        await client.query(
          `INSERT INTO permission_fields (resource, field_name, category, label, column_width, column_order)
           VALUES ('leads', $1, $2, $3, $4, $5)`,
          [ENTRY.field, ENTRY.category, ENTRY.label, ENTRY.width, ord]);
        console.log(`inserted catalog: ${ENTRY.field} -> "${ENTRY.label}" (width ${ENTRY.width}, order ${ord})`);
      }
    }

    // Verify
    const present = (await client.query(
      `SELECT field_name FROM permission_fields
        WHERE resource = 'leads' AND field_name = $1 AND column_width IS NOT NULL`, [ENTRY.field])).rowCount > 0;
    const ok = RESET ? !present : present;
    console.log(`\nVerification — ${ENTRY.field} ${present ? 'in catalog' : 'not in catalog'}`);
    if (!ok) throw new Error('Verification failed — catalog not in the expected state. Rolling back.');

    await client.query('COMMIT');
    console.log(`\nCOMMITTED — ${RESET ? 'removed' : 'added'} the Order Phase catalog entry.`);
    if (!RESET) console.log('Re-login (or refresh) so the frontend re-fetches /api/staff/columns.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nROLLED BACK — no changes made:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch(e => { console.error(e); process.exit(1); });

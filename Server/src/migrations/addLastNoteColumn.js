// Registers "Last Note" (lastNoteAt) in the Leads-list column catalog
// (permission_fields) — the date/time of a person's most recent note,
// computed live in staffController.searchLeads() (LEFT JOIN LATERAL against
// student_notes, no schema change needed for the data itself). This
// migration only makes it show up as a proper, labeled, orderable,
// toggleable column instead of an untitled raw field.
//
// No role_field_permissions rows needed: getFieldPermission() defaults an
// unregistered field to { list:'view', detail:'edit' } (confirmed against
// prod — most of the 27 current staff profiles already see createdAt/
// updatedAt this way, with no explicit row at all), so lastNoteAt is visible
// to everyone by default, same as every other Key Dates column.
//
// Idempotent. Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/addLastNoteColumn.js
//   PROD: node src/migrations/addLastNoteColumn.js --allow-remote
require('dotenv').config();
const { Pool } = require('pg');

const url  = process.env.DATABASE_URL || '';
const host = (url.split('@')[1] || '').split('/')[0] || '(unknown)';
const isLocal     = /localhost|127\.0\.0\.1|studylink_dev/.test(url);
const allowRemote = process.argv.includes('--allow-remote');

if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!isLocal && !allowRemote) {
  console.error(`Refusing to run against non-local DB (${host}) without --allow-remote`);
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });

(async () => {
  console.log('Target DB host: ' + host);

  // Fits in the existing "Key Dates" category, right after cancellationDate
  // (order 50) — see personCreatedAt/personUpdatedAt/assignedIn/assignedOut/
  // closeDate/actualCloseDate/cancellationDate, all order 41-50.
  const r = await pool.query(
    `INSERT INTO permission_fields (field_name, category, resource, label, column_width, column_order)
          VALUES ('lastNoteAt', 'Key Dates', 'leads', 'Last Note', 110, 51)
     ON CONFLICT (field_name) DO UPDATE
       SET label = EXCLUDED.label, column_width = EXCLUDED.column_width, column_order = EXCLUDED.column_order
     RETURNING field_name, label, column_width, column_order, category`
  );
  console.log('permission_fields row:', r.rows[0]);

  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

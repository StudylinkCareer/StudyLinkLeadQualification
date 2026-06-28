// server/src/migrations/addLeadFieldsToColumnCatalog.js
//
// Adds identity + lead-distinguishing engagement fields to the Leads-list column
// catalog (permission_fields) so they become selectable in Column Settings and
// renderable as grid columns:
//   leadId            → "Lead ID"      (pinned first; was code-only-prepended)
//   studentId         → "Student ID"   (pinned second)
//   intake            → "Intake"
//   degreeLevel       → "Degree"
//   targetInstitution → "Institution"
//   rationale         → "Rationale"
//
// leadId/studentId were previously injected only in Leads.jsx (not in the
// catalog), so they could not appear in Column Settings. The frontend prepend
// is removed in the same change; both now come from the catalog like every
// other column.
//
// The catalog = rows in permission_fields where column_width IS NOT NULL
// (staffController.listColumns). These four were added to the `leads` table by
// addLeadFields.js but were never registered in the catalog, so they could not
// appear in the list. They are neutral engagement fields (no PII), and the
// field-permission default is { list:'view', detail:'edit' }, so all roles see
// them without masking — no role_field_permissions rows are needed.
//
// NOTE on "all fields": the remaining un-cataloged permission_fields rows are
// deliberately left out here — they are either internal plumbing (oceanQ1..15,
// qrCodeImageUrl, headshotUrl, *CountryCode, contactDetail/medium duplicates,
// uniqueId) or potentially sensitive (counselingNotes, managementNotes,
// caseOfficerNotes). Promoting the sensitive ones would expose them to every
// role by default — add those explicitly (with role_field_permissions) only on
// request.
//
// SAFETY: localhost-guarded, transaction-wrapped, idempotent, reversible
// (--reset removes the four catalog entries again; it does NOT touch the
// underlying leads columns).
//
// USAGE (from Server/, DATABASE_URL -> studylink_dev):
//   node src/migrations/addLeadFieldsToColumnCatalog.js          # add to catalog
//   node src/migrations/addLeadFieldsToColumnCatalog.js --reset  # remove again

require('dotenv').config();
const { Pool } = require('pg');

const ARGS         = process.argv.slice(2);
const RESET        = ARGS.includes('--reset');
const ALLOW_REMOTE = ARGS.includes('--allow-remote');

// resource is always 'leads' (the only resource in permission_fields).
// category 'other' matches the existing engagement fields (major, studyPlans,
// timeline are all 'other'). column_width chosen to fit typical values.
// `order` (optional) pins a fixed column_order; entries without it are appended
// after the current max order. Identity fields are pinned to the front (negative
// order) so Lead ID / Student ID lead the grid.
const ENTRIES = [
  { field: 'leadId',            label: 'Lead ID',     category: 'other', width: 90,  order: -2 },
  { field: 'studentId',         label: 'Student ID',  category: 'other', width: 120, order: -1 },
  { field: 'intake',            label: 'Intake',      category: 'other', width: 130 },
  { field: 'degreeLevel',       label: 'Degree',      category: 'other', width: 120 },
  { field: 'targetInstitution', label: 'Institution', category: 'other', width: 180 },
  { field: 'rationale',         label: 'Rationale',   category: 'other', width: 220 },
];

function hostOf(url) {
  const m = /@([^:@/]+)(?::\d+)?\//.exec(url || '');
  return m ? m[1] : '(unparseable)';
}

async function main() {
  const url  = process.env.DATABASE_URL || '';
  const host = hostOf(url);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host);

  console.log(`Target DB host: ${host}`);
  console.log(`Direction: ${RESET ? 'REMOVE catalog entries (--reset)' : 'ADD catalog entries'}`);
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

    const fieldNames = ENTRIES.map(e => e.field);

    if (RESET) {
      // Remove the four catalog entries entirely (they were inserted by this script).
      const res = await client.query(
        `DELETE FROM permission_fields WHERE resource = 'leads' AND field_name = ANY($1)`,
        [fieldNames]
      );
      console.log(`removed ${res.rowCount} catalog row(s)`);
    } else {
      // Append after the current max column_order so they land at the end of the grid.
      const maxOrder = (await client.query(
        `SELECT COALESCE(MAX(column_order), 0) AS m FROM permission_fields`
      )).rows[0].m;
      let order = Number(maxOrder);

      for (const e of ENTRIES) {
        const ord = (e.order !== undefined) ? e.order : (order += 1, order);
        // Idempotent upsert by (resource, field_name): update if present, else insert.
        const existing = await client.query(
          `SELECT id FROM permission_fields WHERE resource = 'leads' AND field_name = $1 LIMIT 1`,
          [e.field]
        );
        if (existing.rowCount) {
          await client.query(
            `UPDATE permission_fields
                SET label = $1, category = $2, column_width = $3, column_order = $4
              WHERE id = $5`,
            [e.label, e.category, e.width, ord, existing.rows[0].id]
          );
          console.log(`updated catalog: ${e.field.padEnd(18)} -> "${e.label}" (width ${e.width}, order ${ord})`);
        } else {
          await client.query(
            `INSERT INTO permission_fields (resource, field_name, category, label, column_width, column_order)
             VALUES ('leads', $1, $2, $3, $4, $5)`,
            [e.field, e.category, e.label, e.width, ord]
          );
          console.log(`inserted catalog: ${e.field.padEnd(18)} -> "${e.label}" (width ${e.width}, order ${ord})`);
        }
      }
    }

    // Verify
    const present = (await client.query(
      `SELECT field_name FROM permission_fields
        WHERE resource = 'leads' AND field_name = ANY($1) AND column_width IS NOT NULL`,
      [fieldNames]
    )).rows.map(r => r.field_name);

    console.log('\n── Verification (in catalog?) ─────────────────');
    for (const e of ENTRIES) {
      console.log(`${e.field.padEnd(20)} : ${present.includes(e.field) ? 'in catalog' : 'not in catalog'}`);
    }
    const ok = RESET ? present.length === 0 : present.length === ENTRIES.length;
    if (!ok) throw new Error('Verification failed — catalog not in the expected state. Rolling back.');

    await client.query('COMMIT');
    console.log(`\nCOMMITTED — ${RESET ? 'removed' : 'added'} ${ENTRIES.length} catalog entries.`);
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

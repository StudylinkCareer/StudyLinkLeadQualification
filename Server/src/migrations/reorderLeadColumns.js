// Reorders two columns in the Leads-list column catalog (permission_fields),
// per explicit request (2026-08):
//   - "Name" (fullName) moves to right after "Sales ID" (studentId) AND
//     "Lead ID" (leadId) — was 2nd (right after Sales ID, before Lead ID).
//   - "Last Note" (lastNoteAt) moves to right after "Age" — was near the
//     very end (Key Dates category, added in the same session it debuted).
//
// Approach: read the full current list-column order (column_width IS NOT
// NULL), remove fullName/lastNoteAt from wherever they sit, reinsert them
// right after leadId/age respectively, then renumber the WHOLE list 1..N so
// there are no gaps or duplicate order values afterward (there was already
// one accidental duplicate at 51 — lastNoteAt landed on top of
// businessDevelopment when it was added — this cleans that up too).
//
// Idempotent: reads current order fresh each run, so running it twice
// reproduces the same final order (fullName/lastNoteAt are already next to
// their anchors on the 2nd run, so removing+reinserting is a no-op).
//
// Guard: refuses a non-local DB unless --allow-remote.
//   DEV : node src/migrations/reorderLeadColumns.js
//   PROD: node src/migrations/reorderLeadColumns.js --allow-remote
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

function moveAfter(list, moving, anchor) {
  const withoutMoving = list.filter(f => f !== moving);
  const anchorIdx = withoutMoving.indexOf(anchor);
  if (anchorIdx === -1) throw new Error(`Anchor field "${anchor}" not found`);
  withoutMoving.splice(anchorIdx + 1, 0, moving);
  return withoutMoving;
}

(async () => {
  console.log('Target DB host: ' + host);

  const { rows } = await pool.query(
    `SELECT field_name FROM permission_fields
      WHERE column_width IS NOT NULL
      ORDER BY column_order ASC, field_name ASC`
  );
  let order = rows.map(r => r.field_name);
  console.log(`Current list-column count: ${order.length}`);

  order = moveAfter(order, 'fullName', 'leadId');
  order = moveAfter(order, 'lastNoteAt', 'age');

  await pool.query('BEGIN');
  try {
    for (let i = 0; i < order.length; i++) {
      await pool.query(
        `UPDATE permission_fields SET column_order = $1 WHERE field_name = $2`,
        [i + 1, order[i]]
      );
    }
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }

  const check = await pool.query(
    `SELECT field_name, label, column_order FROM permission_fields
      WHERE column_width IS NOT NULL
      ORDER BY column_order ASC LIMIT 8`
  );
  console.log('First 8 columns after reorder:');
  check.rows.forEach(r => console.log(`  ${r.column_order} ${r.field_name} (${r.label})`));

  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });

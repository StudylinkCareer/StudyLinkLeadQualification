// server/src/migrations/exportEventsForTagging.js
// Run from Server\ :  node src/migrations/exportEventsForTagging.js
//
// STEP 1 of moving the old marketing list into the new structure.
// READ-ONLY against PROD — touches nothing. Dumps every lookup_values row
// under category='referral_source' (your current live list) into
// events_tagging.csv with BLANK routing columns for you to fill in.
//
// The old list is a MIX (events + sub-agents + partners), so each row gets
// a `destination` so you can send it to the right place:
//     event     → fill `group` + `type`         (→ events table)
//     subagent  → optionally fill `sub_type`     (→ subagents list)
//     partner   →                                (→ partners list)
//     (blank)   → skipped
//
// Vietnamese names preserved (UTF-8 BOM for Excel). Re-runnable.

require('dotenv').config();
const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function run() {
  try {
    const r = await pool.query(
      `SELECT id, code, subcategory,
              meta->>'startDate' AS start_date,
              meta->>'endDate'   AS end_date,
              is_active
         FROM lookup_values
        WHERE category = 'referral_source'
        ORDER BY sort_order DESC, code ASC`
    );

    const header = ['old_id', 'name', 'start_date', 'end_date', 'old_category', 'is_active',
                    'destination', 'group', 'type', 'sub_type'];
    const lines = [header.join(',')];
    for (const row of r.rows) {
      lines.push([
        row.id, row.code, row.start_date || '', row.end_date || '',
        row.subcategory || '', row.is_active,
        '', '', '', '',   // destination, group, type, sub_type — for you to fill
      ].map(csvField).join(','));
    }

    const out = path.resolve(process.cwd(), 'events_tagging.csv');
    fs.writeFileSync(out, '\uFEFF' + lines.join('\r\n'), 'utf8');
    console.log(`\n✓ Exported ${r.rows.length} rows to:\n  ${out}`);

    console.log('\nFor each row, set "destination" to one of:  event | subagent | partner   (blank = skip)\n');

    const tax = await pool.query(
      `SELECT subcategory AS grp, code AS typ FROM lookup_values
        WHERE category = 'event_type' AND is_active = true
        ORDER BY subcategory ASC, sort_order ASC`
    );
    console.log('If destination = event, fill "group" + "type" using these exact values:');
    let cur = null;
    for (const t of tax.rows) {
      if (t.grp !== cur) { console.log(`\n  group: ${t.grp}`); cur = t.grp; }
      console.log(`     type: ${t.typ}`);
    }
    console.log('\nIf destination = subagent, optionally set "sub_type" to one of:');
    console.log('  Agency | Banking | Language school | Language tutoring centres | Full service sub-agent');
    console.log('\n(partner rows need nothing but the name. Re-runnable.)');
  } catch (err) {
    console.error('Export failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();

// server/src/migrations/importEventsFromTagging.js
// Run from Server\ :  node src/migrations/importEventsFromTagging.js
//   (optional custom path:  node src/migrations/importEventsFromTagging.js mysheet.csv)
//
// STEP 2 — routes the tagged events_tagging.csv into the right tables based on
// each row's `destination`:
//     event     → events   (group + type validated against the seeded lists)
//     subagent  → subagents (name, optional sub_type)
//     partner   → partners  (name)
//     (blank)   → skipped
//
// Idempotent everywhere (ON CONFLICT upserts), so fix the sheet and re-run.
// Does NOT touch the old referral_source list — PROD keeps using it until the
// LQ form is cut over.

require('dotenv').config();
const { Pool }  = require('pg');
const { parse } = require('csv-parse/sync');
const fs   = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const cleanDate = (v) => (v && ISO.test(v.trim())) ? v.trim() : null;

async function run() {
  const file = path.resolve(process.cwd(), process.argv[2] || 'events_tagging.csv');
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}\nRun exportEventsForTagging.js first, or pass the path.`);
    process.exit(1);
  }
  const rows = parse(fs.readFileSync(file), {
    columns: true, skip_empty_lines: true, trim: true, bom: true,
  });

  const client = await pool.connect();
  try {
    const tax = await client.query(
      `SELECT subcategory AS grp, code AS typ FROM lookup_values
        WHERE category = 'event_type' AND is_active = true`
    );
    const validET = new Set(tax.rows.map(t => `${t.grp}||${t.typ}`));

    const counts = { event: 0, subagent: 0, partner: 0 };
    let skipped = 0;
    const invalid = [];

    await client.query('BEGIN');
    for (const row of rows) {
      const dest = (row.destination || '').trim().toLowerCase();
      const name = (row.name || '').trim();
      if (!dest || !name) { skipped++; continue; }

      if (dest === 'event') {
        const group = (row.group || '').trim();
        const type  = (row.type  || '').trim();
        if (!group || !type || !validET.has(`${group}||${type}`)) {
          invalid.push(`event "${name}" → group/type "${group}/${type}"`); continue;
        }
        await client.query(
          `INSERT INTO events (event_group, event_type, name, start_date, end_date, meta, is_active)
           VALUES ($1,$2,$3,$4::date,$5::date,'{}'::jsonb,true)
           ON CONFLICT (event_group, event_type, name)
           DO UPDATE SET start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date, is_active=true`,
          [group, type, name, cleanDate(row.start_date), cleanDate(row.end_date)]
        );
        counts.event++;

      } else if (dest === 'subagent') {
        const subType = (row.sub_type || '').trim() || null;
        await client.query(
          `INSERT INTO subagents (name, type, is_active)
           VALUES ($1,$2,true)
           ON CONFLICT (name) DO UPDATE SET type = COALESCE(EXCLUDED.type, subagents.type), is_active = true`,
          [name, subType]
        );
        counts.subagent++;

      } else if (dest === 'partner') {
        await client.query(
          `INSERT INTO partners (name, is_active)
           VALUES ($1,true)
           ON CONFLICT (name) DO UPDATE SET is_active = true`,
          [name]
        );
        counts.partner++;

      } else {
        invalid.push(`"${name}" → unknown destination "${row.destination}"`);
      }
    }
    await client.query('COMMIT');

    console.log(`\n✓ Imported:  ${counts.event} events,  ${counts.subagent} sub-agents,  ${counts.partner} partners`);
    if (skipped) console.log(`  Skipped ${skipped} blank/unrouted rows`);
    if (invalid.length) {
      console.log(`\n  ⚠ ${invalid.length} rows not imported (fix + re-run):`);
      invalid.forEach(i => console.log(`     - ${i}`));
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Import failed (rolled back):', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();

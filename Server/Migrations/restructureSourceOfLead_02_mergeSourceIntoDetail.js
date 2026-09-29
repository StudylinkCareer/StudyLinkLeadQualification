// Source of Lead restructure — Phase 2: merge `source` into `source_detail`
// wherever `source_detail` is empty, on both `students` and `lead_events` (the
// two tables that carry these columns — see Phase 1's comment). `source` is not
// dropped here — that's Phase 7, after Phase 3's manual reclassification and
// Phase 6's report rewiring are both done.
//
// Rows where BOTH columns are already filled and disagree are intentionally left
// alone (per the spec) — that `source` value would be lost once the column is
// eventually dropped, so this prints them for a human to review before that happens.
//
// Idempotent: re-running only touches rows that still have an empty source_detail,
// which after the first run is none — the second run reports 0 in both tables.
//
// Usage: node Migrations/restructureSourceOfLead_02_mergeSourceIntoDetail.js [--allow-remote]
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

async function mergeTable(client, table) {
  const res = await client.query(
    `UPDATE ${table}
        SET source_detail = source, updated_at = now()
      WHERE source IS NOT NULL AND btrim(source) <> ''
        AND (source_detail IS NULL OR btrim(source_detail) = '')`
  );
  console.log(`  ${table}: merged ${res.rowCount} row(s)`);
}

async function mismatchReport(client, table) {
  const res = await client.query(
    `SELECT source, source_detail, COUNT(*) AS n
       FROM ${table}
      WHERE source IS NOT NULL AND btrim(source) <> ''
        AND source_detail IS NOT NULL AND btrim(source_detail) <> ''
        AND source <> source_detail
      GROUP BY source, source_detail
      ORDER BY n DESC`
  );
  if (!res.rows.length) { console.log(`  ${table}: no mismatches`); return; }
  console.log(`  ${table}: ${res.rows.length} distinct mismatch(es) — 'source' value below will be LOST once the column is dropped (Phase 7); review with the business first:`);
  console.table(res.rows);
}

(async () => {
  console.log('Target DB host: ' + host);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('\n-- merging source -> source_detail (only where source_detail is empty) --');
    await mergeTable(client, 'students');
    await mergeTable(client, 'lead_events');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log('\n-- mismatch report (source kept as-is, will be lost when the column is dropped) --');
  await mismatchReport(pool, 'students');
  await mismatchReport(pool, 'lead_events');

  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

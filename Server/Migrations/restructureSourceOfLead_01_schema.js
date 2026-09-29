// Source of Lead restructure — Phase 1: additive lookup_values groundwork.
// Nothing user-visible changes on its own (labels only change display text; new
// rows are additive; deactivated rows stay selectable for leads that already
// have them via the existing "withCur" pattern in LeadDetail.jsx). Safe to
// re-run — every step is an upsert/relabel/deactivate, never a delete.
//
// Target end state (per the plan): 5 fixed Source of Lead values —
//   Databases (staff-only) / On-line / Third party event / B2B referral
//   (staff-only) / Personal referral — with "Event/Campaign" removed as an
//   option (it's now a dedicated field, parked in a separate plan).
// "staff-only" = meta.hidden_from_customer_app, read by the public
// /api/reference-data/public/source-options endpoint (see Phase 4).
//
// Usage: node Migrations/restructureSourceOfLead_01_schema.js [--allow-remote]
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

// Relabel only (never the `code` — that's the value stored on students.lead_source /
// students.source, and LeadDetail.jsx's SOL_MODE keys off `code` too; changing it
// would require a data migration on every lead that already has it).
const RELABEL = [
  { category: 'source_of_lead', code: 'B2B referrals',      labelEn: 'B2B referral',      labelVi: 'Đối tác giới thiệu' },
  { category: 'source_of_lead', code: 'Personal referrals',  labelEn: 'Personal referral', labelVi: 'Người giới thiệu' },
];

// New rows. mode:'none' is a new SOL_MODE value (Phase 5's job to render it — no
// sub-field at all); until then it just behaves like an unrecognized mode, same as
// any other lookup addition ahead of its UI.
const NEW_SOL_ROWS = [
  { code: 'Third party event', labelEn: 'Third party event', labelVi: 'Sự kiện đối tác', mode: 'none' },
];

// New `source` sub-values. On-line's target list is FB/Instagram, Zalo, Google,
// TikTok, AI, Other — 'Zalo' already exists verbatim, so only the other 5 are new.
const NEW_SOURCE_ROWS = [
  { subcategory: 'On-line',            code: 'FB/Instagram' },
  { subcategory: 'On-line',            code: 'Google' },
  { subcategory: 'On-line',            code: 'TikTok' },
  { subcategory: 'On-line',            code: 'AI' },
  { subcategory: 'On-line',            code: 'Other' },
  // Personal referral's new category picker (owner, 2026-09-28): Staff / Ex-client
  // already exist; Walk-in is dropped (no longer needed); "Others" is new.
  { subcategory: 'Personal referrals', code: 'Others', labelVi: 'Khác' },
];

// Deactivated, never deleted — historical leads keep showing their value via
// LeadDetail.jsx's withCur() pattern; Phase 3's tool is where these get reclassified.
const DEACTIVATE = [
  { category: 'source_of_lead', code: 'Event/Campaign' },                 // now a dedicated field (parked plan)
  { category: 'source',         subcategory: 'On-line', code: 'FB Ad' },
  { category: 'source',         subcategory: 'On-line', code: 'ZNS' },
  { category: 'source',         subcategory: 'On-line', code: 'Google Ad' },
  { category: 'source',         subcategory: 'On-line', code: 'LadiPage' },
  { category: 'source',         subcategory: 'On-line', code: 'Tik Tok Ad' },
  { category: 'source',         subcategory: 'On-line', code: 'Email' },
  { category: 'source',         subcategory: 'On-line', code: 'eBook FB' },
  { category: 'source',         subcategory: 'On-line', code: 'eBook Web' },
  { category: 'source',         subcategory: 'Personal referrals', code: 'Walk-in' }, // owner: "no longer needed"
  { category: 'b2b_type',       code: 'School Outreach' },                // promoted to top-level "Third party event"
];

// Databases and B2B referral are staff-only: never shown/selectable in the customer
// app (owner, 2026-09-28). NOTE this deliberately does NOT include Third party
// event — the spec doc's own "(ẩn v Index)" annotation for it is superseded by
// this explicit instruction.
const HIDE_FROM_CUSTOMER = ['Databases', 'B2B referrals'];

async function relabel(client, r) {
  const res = await client.query(
    `UPDATE lookup_values SET label_en=$3, label_vi=$4
      WHERE category=$1 AND code=$2 RETURNING id`,
    [r.category, r.code, r.labelEn, r.labelVi]);
  console.log(`  relabel ${r.category}/${r.code}: ${res.rowCount ? 'updated' : 'NOT FOUND'}`);
}

async function upsertRow(client, category, row, { subcategory = null, extraMeta = {} } = {}) {
  const meta = { ...(row.mode ? { mode: row.mode } : {}), ...extraMeta };
  const existing = await client.query(
    `SELECT id FROM lookup_values WHERE category=$1 AND COALESCE(subcategory,'')=COALESCE($2,'') AND code=$3`,
    [category, subcategory, row.code]);
  if (existing.rowCount) {
    await client.query(
      `UPDATE lookup_values SET is_active=true, label_en=COALESCE($2,label_en), label_vi=COALESCE($3,label_vi),
              meta = meta || $4::jsonb
        WHERE id=$1`,
      [existing.rows[0].id, row.labelEn || null, row.labelVi || null, JSON.stringify(meta)]);
    console.log(`  ${category}${subcategory ? '/' + subcategory : ''}/${row.code}: reactivated/updated`);
    return;
  }
  const ns = await client.query(
    `SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM lookup_values WHERE category=$1 AND COALESCE(subcategory,'')=COALESCE($2,'')`,
    [category, subcategory]);
  await client.query(
    `INSERT INTO lookup_values (category, subcategory, code, label_en, label_vi, sort_order, is_active, meta)
     VALUES ($1,$2,$3,$4,$5,$6,true,$7::jsonb)`,
    [category, subcategory, row.code, row.labelEn || row.code, row.labelVi || row.code, ns.rows[0].n, JSON.stringify(meta)]);
  console.log(`  ${category}${subcategory ? '/' + subcategory : ''}/${row.code}: inserted`);
}

async function deactivate(client, d) {
  const res = await client.query(
    `UPDATE lookup_values SET is_active=false
      WHERE category=$1 AND COALESCE(subcategory,'')=COALESCE($2,'') AND code=$3 RETURNING id`,
    [d.category, d.subcategory || null, d.code]);
  console.log(`  deactivate ${d.category}${d.subcategory ? '/' + d.subcategory : ''}/${d.code}: ${res.rowCount ? 'done' : 'not found (already gone?)'}`);
}

async function setHidden(client, code) {
  const res = await client.query(
    `UPDATE lookup_values SET meta = meta || '{"hidden_from_customer_app":true}'::jsonb
      WHERE category='source_of_lead' AND code=$1 RETURNING id`,
    [code]);
  console.log(`  hide-from-customer-app source_of_lead/${code}: ${res.rowCount ? 'set' : 'NOT FOUND'}`);
}

(async () => {
  console.log('Target DB host: ' + host);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('\n-- relabel --');
    for (const r of RELABEL) await relabel(client, r);

    console.log('\n-- new source_of_lead rows --');
    for (const r of NEW_SOL_ROWS) await upsertRow(client, 'source_of_lead', r);

    console.log('\n-- new source rows --');
    for (const r of NEW_SOURCE_ROWS) await upsertRow(client, 'source', r, { subcategory: r.subcategory });

    console.log('\n-- deactivate legacy values --');
    for (const d of DEACTIVATE) await deactivate(client, d);

    console.log('\n-- hide staff-only Source of Lead values from the customer app --');
    for (const code of HIDE_FROM_CUSTOMER) await setHidden(client, code);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log('\n-- final state --');
  const sol = await pool.query(`SELECT code, subcategory, label_en, label_vi, meta, is_active FROM lookup_values WHERE category='source_of_lead' ORDER BY sort_order`);
  console.table(sol.rows);
  const src = await pool.query(`SELECT code, subcategory, label_en, is_active FROM lookup_values WHERE category='source' ORDER BY subcategory, sort_order`);
  console.table(src.rows);
  const b2b = await pool.query(`SELECT code, label_en, is_active FROM lookup_values WHERE category='b2b_type' ORDER BY sort_order`);
  console.table(b2b.rows);

  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });

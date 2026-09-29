// Source of Lead restructure — Phase 8 cleanup: deactivate confirmed-dead
// older lookup categories, so local dev / prod's lookup_values table stops
// showing options that no code path reads any more.
//
// `lead_source` (5 rows: Databases, FB-Zalo-GG-TikTok ads, School outreach,
// Subagent referrals, Ex-client) is a leftover category from before
// `source_of_lead` existed — confirmed via grep that no route/query in
// Server/src reads category='lead_source' (the actively-used category for
// students.lead_source's dropdown is 'source_of_lead', joined that way in
// rangeReport.js/eventSourceBreakdown.js/referenceData.js). The other
// categories named in the plan (marketing_category, marketing_channel,
// marketing_attendance, client_type, marketing_subcategory) have zero rows
// in this DB — nothing to deactivate.
//
// Soft-deactivate only (is_active=false, never delete) — safe/reversible,
// idempotent (only touches currently-active rows).
//
// Usage: node Migrations/restructureSourceOfLead_05_deactivateDeadLookups.js [--allow-remote]
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

const DEAD_CATEGORIES = ['lead_source', 'marketing_category', 'marketing_channel', 'marketing_attendance', 'client_type', 'marketing_subcategory'];

(async () => {
  console.log('Target DB host: ' + host);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const category of DEAD_CATEGORIES) {
      const res = await client.query(
        `UPDATE lookup_values SET is_active=false WHERE category=$1 AND is_active=true RETURNING code`,
        [category]);
      console.log(`  ${category}: deactivated ${res.rowCount} row(s)${res.rowCount ? ' (' + res.rows.map(r => r.code).join(', ') + ')' : ''}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
